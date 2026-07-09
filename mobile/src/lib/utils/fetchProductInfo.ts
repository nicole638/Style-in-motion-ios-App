// Product info fetching — four-tier strategy:
//
// 1. Direct fetch — free, no credits, works for SSR sites that serve OG/JSON-LD in HTML.
// 2. Backend /api/product-info — server-side ScrapingBee call with stable IP.
// 3. Microlink.io — 250 req/day free, no key.
// 4. Jsonlink.io — free fallback.
//
// Parser cascade (per source): JSON-LD → OG → Twitter → title fallback.
// Telemetry: each attempt logged to metadata_fetch_logs for routing analysis.

import { parseProductMetadata, isGoodEnough, type ParsedProductMetadata } from './parseProductMetadata';
import { supabase } from '../supabase';
import { stripTrackingParams } from './stripTrackingParams';
import { getSourceOrder, getRoutingTag, type ScraperSource } from './scraperRouting';
import { getScrapingBeeMode } from './scrapingbee-routing';

export type ProductInfo = {
  name: string | null;
  brand: string | null;
  price: string | null;
  imageUrl: string | null;
  // Up to 6 candidate image URLs (deduped, primary first) for the multi-image
  // picker. Populated on direct + backend paths; microlink/jsonlink only emit
  // a single image so the array is length ≤ 1 there.
  imageUrls: string[];
  // Set when the backend cached the merchant image to our Storage. imageUrl is
  // then the supabase URL; originalImageUrl is the merchant CDN URL we fetched.
  // Null on direct/microlink/jsonlink paths (no caching there).
  originalImageUrl: string | null;
  description: string | null;
  siteName: string | null;
  canonicalUrl: string | null;
};

const NULL_PRODUCT: ProductInfo = {
  name: null, brand: null, price: null, imageUrl: null, imageUrls: [], originalImageUrl: null,
  description: null, siteName: null, canonicalUrl: null,
};

function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw.trim();
  const sitePrefixMatch = name.match(/^[^:]{1,30}\.(?:com|net|org|co|io)\s*:\s*/i);
  if (sitePrefixMatch) name = name.substring(sitePrefixMatch[0].length).trim();
  const pipeIndex = name.indexOf('|');
  if (pipeIndex !== -1) name = name.substring(0, pipeIndex).trim();
  const emDashIndex = name.indexOf('\u2014');
  if (emDashIndex !== -1) name = name.substring(0, emDashIndex).trim();
  if (name.length > 80) name = name.substring(0, 80).trim();
  return name.length === 0 ? null : name;
}

function isPromoImage(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('amazon_fashion') || lower.includes('site_flips') ||
    lower.includes('amz-brands') || lower.includes('trending-now') ||
    lower.includes('banner') || lower.includes('promo') ||
    lower.includes('swatch') || lower.includes('icon') ||
    lower.includes('50x') || lower.includes('100x') ||
    lower.includes('_small') || lower.includes('_compact') || lower.includes('_pico')
  );
}

function extractPrice(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = String(text).match(/\$[\d,]+\.?\d{0,2}/);
  return match ? match[0] : null;
}

function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

// --------------- Telemetry ---------------

interface FetchAttempt {
  url: string;
  source: string;
  sourceOrder: number;
  httpStatus: number | null;
  latencyMs: number;
  ok: boolean;
  parsed: ParsedProductMetadata | null;
  errorMessage: string | null;
  isFinal: boolean;
}

// Telemetry sink — records who *attempted* a URL fetch, NOT who owns the
// resulting closet item. This stays as the signed-in human even when she's
// in storefront context: the question being answered is "who's hammering
// the metadata fetcher" (analytics + abuse), not "which closet did this
// item land in." The closet-write writeAs semantics are enforced by the
// caller of the *inserts*, not here.
async function logAttempts(attempts: FetchAttempt[], creatorId: string | null) {
  if (attempts.length === 0) return;
  try {
    const rows = attempts.map(a => {
      const fields = a.parsed ? {
        name: !!a.parsed.name,
        brand: !!a.parsed.brand,
        price: !!a.parsed.price,
        image: !!a.parsed.imageUrl,
        description: !!a.parsed.description,
      } : { name: false, brand: false, price: false, image: false, description: false };
      const fieldsCount = Object.values(fields).filter(Boolean).length;
      return {
        url: a.url,
        domain: domainFromUrl(a.url) ?? 'unknown',
        source: a.source,
        source_order: a.sourceOrder,
        http_status: a.httpStatus,
        latency_ms: a.latencyMs,
        ok: a.ok,
        fields_count: fieldsCount,
        field_flags: fields,
        parser_path: a.parsed?._parserPath ?? 'none',
        is_final: a.isFinal,
        error_message: a.errorMessage,
        creator_id: creatorId,
      };
    });
    await supabase.from('metadata_fetch_logs').insert(rows);
  } catch (e) {
    console.warn('[ProductInfo] Telemetry insert failed (non-blocking):', e);
  }
}

// --------------- Converters ---------------

function parsedToProductInfo(parsed: ParsedProductMetadata, url: string): ProductInfo {
  let siteName = parsed.brand;
  if (siteName) {
    siteName = siteName.replace(/\s*(United States|US|USA|UK|Canada)\s*/gi, '').trim() || null;
  }
  if (!siteName) siteName = domainFromUrl(url);

  const shortUrlBrands: Record<string, string> = {
    'a.co': 'Amazon', 'amzn.to': 'Amazon', 'amzn.com': 'Amazon',
  };
  const domain = domainFromUrl(url);
  if (domain && shortUrlBrands[domain] && !siteName) {
    siteName = shortUrlBrands[domain]!;
  }

  let imageUrl = parsed.imageUrl;
  if (imageUrl && isPromoImage(imageUrl)) imageUrl = null;

  const rawCandidates: string[] = Array.isArray(parsed.imageUrls) ? parsed.imageUrls : [];
  const candidates = rawCandidates
    .map((u) => (typeof u === 'string' && u.startsWith('http://') ? 'https://' + u.slice('http://'.length) : u))
    .filter((u): u is string => typeof u === 'string' && u.length > 0 && !isPromoImage(u));
  const seen = new Set<string>();
  const imageUrls: string[] = [];
  if (imageUrl) { imageUrls.push(imageUrl); seen.add(imageUrl); }
  for (const u of candidates) {
    if (seen.has(u)) continue;
    seen.add(u);
    imageUrls.push(u);
    if (imageUrls.length >= 6) break;
  }

  return {
    name: cleanName(parsed.name),
    brand: parsed.brand ?? siteName,
    price: parsed.price,
    imageUrl,
    imageUrls,
    originalImageUrl: null,
    description: parsed.description,
    siteName,
    canonicalUrl: parsed.canonicalUrl,
  };
}

function backendResponseToProductInfo(data: any, url: string): ProductInfo {
  let siteName: string | null = data.siteName ?? null;
  if (!siteName) siteName = domainFromUrl(url);
  let imageUrl: string | null = isPromoImage(data.imageUrl) ? null : (data.imageUrl ?? null);
  if (imageUrl && imageUrl.startsWith('http://')) {
    imageUrl = 'https://' + imageUrl.slice('http://'.length);
  }
  const rawCandidates: string[] = Array.isArray(data.imageUrls) ? data.imageUrls : [];
  const candidates = rawCandidates
    .map((u) => (typeof u === 'string' && u.startsWith('http://') ? 'https://' + u.slice('http://'.length) : u))
    .filter((u): u is string => typeof u === 'string' && u.length > 0 && !isPromoImage(u));
  return {
    name: cleanName(data.name),
    brand: data.brand ?? siteName,
    price: data.price ?? null,
    imageUrl,
    imageUrls: candidates,
    originalImageUrl: data.originalImageUrl ?? null,
    description: data.description ?? null,
    siteName,
    canonicalUrl: data.canonicalUrl ?? null,
  };
}

function isUseful(result: ProductInfo): boolean {
  return !!(result.name && (result.imageUrl || result.price));
}

function hasAnything(result: ProductInfo): boolean {
  return !!(result.name || result.price || result.imageUrl);
}

// --------------- Source fetchers ---------------

async function fetchDirect(url: string): Promise<{
  result: ProductInfo; parsed: ParsedProductMetadata | null;
  httpStatus: number | null; latencyMs: number; ok: boolean; error: string | null;
}> {
  console.log('[ProductInfo] Direct fetch attempt for:', url);
  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    const latencyMs = Date.now() - t0;
    if (!response.ok) return { result: { ...NULL_PRODUCT }, parsed: null, httpStatus: response.status, latencyMs, ok: false, error: `HTTP ${response.status}` };
    const ct = response.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
      return { result: { ...NULL_PRODUCT }, parsed: null, httpStatus: response.status, latencyMs, ok: false, error: 'Not HTML' };
    }
    const html = await response.text();
    const parsed = parseProductMetadata(html, url);
    const result = parsedToProductInfo(parsed, url);
    console.log('[ProductInfo] Direct fetch result:', JSON.stringify(result));
    return { result, parsed, httpStatus: response.status, latencyMs, ok: true, error: null };
  } catch (error: any) {
    clearTimeout(timeout);
    const msg = error?.message || String(error);
    console.warn('[ProductInfo] Direct fetch error:', msg);
    return { result: { ...NULL_PRODUCT }, parsed: null, httpStatus: null, latencyMs: Date.now() - t0, ok: false, error: msg };
  }
}

async function fetchFromBackend(url: string): Promise<{
  result: ProductInfo; httpStatus: number | null; latencyMs: number;
  ok: boolean; error: string | null; parserPath: string;
}> {
  const baseUrl = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!baseUrl) {
    console.warn('[ProductInfo] EXPO_PUBLIC_BACKEND_URL not set');
    return { result: { ...NULL_PRODUCT }, httpStatus: null, latencyMs: 0, ok: false, error: 'No backend URL', parserPath: 'none' };
  }
  console.log('[ProductInfo] Backend attempt for:', url);
  const t0 = Date.now();
  const apiUrl = `${baseUrl}/api/product-info?url=${encodeURIComponent(url)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - t0;
    if (!response.ok) {
      console.warn('[ProductInfo] Backend HTTP error:', response.status);
      return { result: { ...NULL_PRODUCT }, httpStatus: response.status, latencyMs, ok: false, error: `HTTP ${response.status}`, parserPath: 'none' };
    }
    const json = await response.json();
    const data = json?.data;
    if (!data) return { result: { ...NULL_PRODUCT }, httpStatus: response.status, latencyMs, ok: false, error: 'No data', parserPath: 'none' };
    const result = backendResponseToProductInfo(data, url);
    const parserPath = data._parserPath ?? 'none';
    console.log('[ProductInfo] Backend result:', JSON.stringify(result));
    return { result, httpStatus: response.status, latencyMs, ok: true, error: null, parserPath };
  } catch (error: any) {
    clearTimeout(timeout);
    const msg = error?.message || String(error);
    console.warn('[ProductInfo] Backend threw:', msg);
    return { result: { ...NULL_PRODUCT }, httpStatus: null, latencyMs: Date.now() - t0, ok: false, error: msg, parserPath: 'none' };
  }
}

async function fetchFromMicrolink(url: string): Promise<{
  result: ProductInfo; httpStatus: number | null; latencyMs: number;
  ok: boolean; error: string | null;
}> {
  console.log('[ProductInfo] Microlink attempt for:', url);
  const t0 = Date.now();
  try {
    const apiUrl = `https://api.microlink.io?url=${encodeURIComponent(url)}`;
    const response = await fetch(apiUrl, { method: 'GET', headers: { Accept: 'application/json' } });
    const latencyMs = Date.now() - t0;
    if (!response.ok) {
      console.warn('[ProductInfo] Microlink HTTP error:', response.status);
      return { result: { ...NULL_PRODUCT }, httpStatus: response.status, latencyMs, ok: false, error: `HTTP ${response.status}` };
    }
    const data = JSON.parse(await response.text());
    if (data.status !== 'success') {
      return { result: { ...NULL_PRODUCT }, httpStatus: response.status, latencyMs, ok: false, error: `status=${data.status}` };
    }
    const rawImage: string | null = data.data?.image?.url ?? null;
    const microlinkImage = isPromoImage(rawImage) ? null : rawImage;
    const result: ProductInfo = {
      name: cleanName(data.data?.title),
      brand: data.data?.publisher ?? domainFromUrl(url),
      price: extractPrice(data.data?.description),
      imageUrl: microlinkImage,
      imageUrls: microlinkImage ? [microlinkImage] : [],
      originalImageUrl: null,
      description: data.data?.description ?? null,
      siteName: data.data?.publisher ?? domainFromUrl(url),
      canonicalUrl: data.data?.url ?? null,
    };
    console.log('[ProductInfo] Microlink result:', JSON.stringify(result));
    return { result, httpStatus: response.status, latencyMs, ok: true, error: null };
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.warn('[ProductInfo] Microlink threw:', msg);
    return { result: { ...NULL_PRODUCT }, httpStatus: null, latencyMs: Date.now() - t0, ok: false, error: msg };
  }
}

async function fetchFromJsonlink(url: string): Promise<{
  result: ProductInfo; httpStatus: number | null; latencyMs: number;
  ok: boolean; error: string | null;
}> {
  console.log('[ProductInfo] Jsonlink attempt for:', url);
  const t0 = Date.now();
  try {
    const apiUrl = `https://jsonlink.io/api/extract?url=${encodeURIComponent(url)}`;
    const response = await fetch(apiUrl, { method: 'GET', headers: { Accept: 'application/json' } });
    const latencyMs = Date.now() - t0;
    if (!response.ok) {
      console.warn('[ProductInfo] Jsonlink HTTP error:', response.status);
      return { result: { ...NULL_PRODUCT }, httpStatus: response.status, latencyMs, ok: false, error: `HTTP ${response.status}` };
    }
    const data = JSON.parse(await response.text());
    let price: string | null = null;
    if (data.price) price = String(data.price);
    else price = extractPrice(data.description);
    const rawJsonImage: string | null = data.images?.[0] ?? null;
    const jsonlinkImage = isPromoImage(rawJsonImage) ? null : rawJsonImage;
    const result: ProductInfo = {
      name: cleanName(data.title),
      brand: data.domain ?? null,
      price,
      imageUrl: jsonlinkImage,
      imageUrls: jsonlinkImage ? [jsonlinkImage] : [],
      originalImageUrl: null,
      description: data.description ?? null,
      siteName: data.domain ?? null,
      canonicalUrl: data.url ?? null,
    };
    console.log('[ProductInfo] Jsonlink result:', JSON.stringify(result));
    return { result, httpStatus: response.status, latencyMs, ok: true, error: null };
  } catch (error: any) {
    const msg = error?.message || String(error);
    console.warn('[ProductInfo] Jsonlink threw:', msg);
    return { result: { ...NULL_PRODUCT }, httpStatus: null, latencyMs: Date.now() - t0, ok: false, error: msg };
  }
}

// --------------- Source dispatch ---------------

type SourceFetcher = (url: string) => Promise<{
  result: ProductInfo;
  parsed?: ParsedProductMetadata | null;
  httpStatus: number | null;
  latencyMs: number;
  ok: boolean;
  error: string | null;
  parserPath?: string;
}>;

function getSourceFetcher(source: ScraperSource): SourceFetcher {
  switch (source) {
    case 'direct': return async (u) => {
      const r = await fetchDirect(u);
      return { result: r.result, parsed: r.parsed, httpStatus: r.httpStatus, latencyMs: r.latencyMs, ok: r.ok, error: r.error };
    };
    case 'backend': return async (u) => {
      const r = await fetchFromBackend(u);
      return { result: r.result, parsed: r.ok ? { name: r.result.name, brand: r.result.brand, price: r.result.price, imageUrl: r.result.imageUrl, imageUrls: r.result.imageUrls, description: r.result.description, canonicalUrl: r.result.canonicalUrl, _parserPath: r.parserPath as any } : null, httpStatus: r.httpStatus, latencyMs: r.latencyMs, ok: r.ok, error: r.error, parserPath: r.parserPath };
    };
    case 'microlink': return async (u) => {
      const r = await fetchFromMicrolink(u);
      return { result: r.result, parsed: null, httpStatus: r.httpStatus, latencyMs: r.latencyMs, ok: r.ok, error: r.error };
    };
    case 'jsonlink': return async (u) => {
      const r = await fetchFromJsonlink(u);
      return { result: r.result, parsed: null, httpStatus: r.httpStatus, latencyMs: r.latencyMs, ok: r.ok, error: r.error };
    };
  }
}

// --------------- Main orchestrator ---------------

export async function fetchProductInfo(
  url: string,
  creatorId?: string | null
): Promise<ProductInfo> {
  if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return { ...NULL_PRODUCT };
  }

  const cleanUrl = stripTrackingParams(url);

  const sbMode = getScrapingBeeMode(cleanUrl);
  if (sbMode) {
    console.log(`[ProductInfo] ScrapingBee domain (${sbMode}), skipping to backend: ${cleanUrl}`);
    const r = await fetchFromBackend(cleanUrl);
    logAttempts([{
      url: cleanUrl, source: `backend-sb-${sbMode}`, sourceOrder: 1,
      httpStatus: r.httpStatus, latencyMs: r.latencyMs, ok: r.ok,
      parsed: null, errorMessage: r.error, isFinal: true,
    }], creatorId ?? null);
    return r.result;
  }

  const sources = getSourceOrder(cleanUrl);
  const routingTag = getRoutingTag(cleanUrl);

  console.log(`[ProductInfo] Starting fetch for: ${cleanUrl} (sources: ${sources.join(' → ')}${routingTag ? `, routing: ${routingTag}` : ''})`);
  const attempts: FetchAttempt[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    const order = i + 1;
    const fetcher = getSourceFetcher(source);
    const check = source === 'jsonlink' ? hasAnything : isUseful;

    try {
      const r = await fetcher(cleanUrl);
      attempts.push({
        url: cleanUrl, source, sourceOrder: order, httpStatus: r.httpStatus,
        latencyMs: r.latencyMs, ok: r.ok, parsed: r.parsed ?? null,
        errorMessage: r.error, isFinal: false,
      });
      if (check(r.result)) {
        console.log(`[ProductInfo] ${source} succeeded`);
        attempts[attempts.length - 1]!.isFinal = true;
        logAttempts(attempts, creatorId ?? null);
        return r.result;
      }
      console.log(`[ProductInfo] ${source} insufficient, trying next`);
    } catch (error: any) {
      console.warn(`[ProductInfo] ${source} threw:`, error?.message || error);
    }
  }

  const bestPartial = attempts
    .filter(a => a.ok)
    .sort((a, b) => {
      const count = (p: ParsedProductMetadata | null) => p ? [p.name, p.brand, p.price, p.imageUrl, p.description].filter(Boolean).length : 0;
      return count(b.parsed) - count(a.parsed);
    })[0];

  if (bestPartial?.parsed) {
    bestPartial.isFinal = true;
    logAttempts(attempts, creatorId ?? null);
    return parsedToProductInfo(bestPartial.parsed, cleanUrl);
  }

  logAttempts(attempts, creatorId ?? null);
  console.warn('[ProductInfo] All services failed for:', cleanUrl);
  return { ...NULL_PRODUCT };
}
