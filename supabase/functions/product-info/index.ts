// product-info — Supabase Edge Function port of the Hono backend's
// /api/product-info route (Vibecode migration, 2026-07-09). Logic verbatim;
// framework surface converted (Hono ctx → Deno.serve Request/Response). The
// helper libs (parseProductMetadata, scrapingbee, shopifyGallery,
// cacheMerchantImage, normalizeUrlInput, decode-entities) ride along as
// sibling files, near-verbatim from backend/src/lib/ — see each header for
// the (minimal) porting notes.
//
// Endpoints (all on GET, matching the legacy route):
//   ?url=<product url>   — single-product scrape cascade (ScrapingBee-targeted
//                          → bot-block cache → direct fetch → ScrapingBee
//                          variants), Amazon-aware parsing, image cached to
//                          Supabase Storage.
//   ?asins=<A,B,…>       — batch Amazon resolver backed by product_info_cache
//                          + the enrich-amazon-asin edge function.
//
// verify_jwt=false — matches the legacy backend's exposure (the app calls it
// with no auth header). All failure paths return null-field results rather
// than errors wherever the legacy did.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { env, getSupabaseAdmin } from "./_shared.ts";
import {
  parseProductMetadata,
  isGoodEnough,
  normalizeImageKey,
  type ParsedProductMetadata,
} from "./parseProductMetadata.ts";
import {
  getScrapingBeeMode,
  fetchViaScrapingBee as fetchTargetedScrapingBee,
  fetchViaScrapingBeeAuto,
  detectBotBlock,
  isCachedBlocked,
  markCachedBlocked,
} from "./scrapingbee.ts";
import { normalizeUrlInput, resolveShortUrl } from "./normalizeUrlInput.ts";
import { cacheMerchantImage } from "./cacheMerchantImage.ts";
import { fetchShopifyProduct, fetchShopifyGalleryUrls, mergeGalleryIntoCandidates } from "./shopifyGallery.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export interface ProductInfoResult {
  name: string | null;
  brand: string | null;
  price: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  originalImageUrl: string | null;
  description: string | null;
  siteName: string | null;
  canonicalUrl: string | null;
  _source: string;
  _parserPath: string;
  _latencyMs: number;
  metadata?: {
    asin?: string | null;
    amazonTrackingParams?: Record<string, string>;
  };
}

const NULL_RESULT: ProductInfoResult = {
  name: null, brand: null, price: null, imageUrl: null, imageUrls: [], originalImageUrl: null,
  description: null, siteName: null, canonicalUrl: null,
  _source: 'none', _parserPath: 'none', _latencyMs: 0,
  metadata: undefined,
};

// Shopify enrichment: for any URL with a `/products/<handle>` path, hit the
// `<origin>/products/<handle>.json` storefront feed and merge the gallery into
// imageUrls. JSON-LD on Shopify stores typically only exposes the cover image,
// so without this the multi-image picker has nothing to show. Non-Shopify URLs
// fall through to a no-op via fetchShopifyGalleryUrls returning [].
async function enrichWithShopifyGallery(result: ProductInfoResult, url: string): Promise<ProductInfoResult> {
  const gallery = await fetchShopifyGalleryUrls(url);
  if (gallery.length === 0) return result;
  const merged = mergeGalleryIntoCandidates(result.imageUrls, gallery);
  return { ...result, imageUrls: merged };
}

// Replaces imageUrl with our Supabase Storage cache so the URL we serve never
// decays. Original merchant URL is preserved on originalImageUrl for debug /
// re-cache. Failures pass through the merchant URL. imageUrls[0] is kept in
// lockstep with imageUrl so old clients reading only imageUrl see no change;
// remaining candidates stay as merchant URLs for the multi-image picker.
async function finalizeWithCache(result: ProductInfoResult): Promise<ProductInfoResult> {
  if (!result.imageUrl) return result;
  const cached = await cacheMerchantImage(result.imageUrl);
  const imageUrls = result.imageUrls.length > 0
    ? [cached.photo_url, ...result.imageUrls.slice(1)]
    : [cached.photo_url];
  return {
    ...result,
    imageUrl: cached.photo_url,
    imageUrls,
    originalImageUrl: cached.original_photo_url,
  };
}

function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw.trim();
  const sitePrefixMatch = name.match(/^[^:]{1,30}\.(?:com|net|org|co|io)\s*:\s*/i);
  if (sitePrefixMatch) name = name.substring(sitePrefixMatch[0].length).trim();
  const pipeIdx = name.indexOf("|");
  if (pipeIdx !== -1) name = name.substring(0, pipeIdx).trim();
  const dashIdx = name.indexOf("—");
  if (dashIdx !== -1) name = name.substring(0, dashIdx).trim();
  if (name.length > 80) name = name.substring(0, 80).trim();
  return name.length === 0 ? null : name;
}

function domainFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

const AMAZON_HOST_RE = /(^|\.)(amazon\.[a-z.]+|a\.co|amzn\.to)$/i;
const AMAZON_PRESERVED_PARAMS = [
  'tag', 'linkCode', 'ascsubtag', 'ref', 'ref_',
  'creativeASIN', 'linkId', 'language', 'psc',
] as const;
const ASIN_RE = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i;

export function isAmazonHost(url: string): boolean {
  try {
    return AMAZON_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function extractAsin(url: string): string | null {
  const m = url.match(ASIN_RE);
  if (!m || !m[1]) return null;
  return m[1].toUpperCase();
}

export function pickAmazonTrackingParams(url: string): Record<string, string> {
  try {
    const params = new URL(url).searchParams;
    const out: Record<string, string> = {};
    for (const key of AMAZON_PRESERVED_PARAMS) {
      const v = params.get(key);
      if (v != null && v !== '') out[key] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Returns a bare canonical Amazon URL suitable for the FETCH/scrape stage
 * (https://www.amazon.com/dp/<ASIN>) when the input is a recognizable Amazon
 * /dp/<ASIN> or /gp/product/<ASIN> URL. Strips ALL query parameters — because
 * Amazon sometimes serves a stripped-down / bot-checked variant when referral
 * params are present, which causes the parser to fall back to title-only.
 *
 * IMPORTANT: this is the FETCH target only. The response's canonicalUrl,
 * metadata.amazonTrackingParams, and metadata.asin are still derived from the
 * ORIGINAL inbound URL by the route handler.
 */
export function canonicalizeAmazonFetchUrl(url: string): string {
  if (!isAmazonHost(url)) return url;
  const asin = extractAsin(url);
  if (!asin) return url;
  return `https://www.amazon.com/dp/${asin}`;
}

// ---------------------------------------------------------------------------
// Amazon DOM extractors
// ---------------------------------------------------------------------------
// Amazon product pages do NOT include JSON-LD, OG, or Twitter card metadata.
// The generic parseProductMetadata cascade therefore falls through to
// title-fallback, which captures the <title> only and leaves image/price/
// brand null. These extractors read directly from Amazon-specific DOM IDs
// (#productTitle, #landingImage, #bylineInfo, .a-offscreen) so we can
// populate the response correctly.

function decodeHtmlAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function extractAmazonProductTitle(html: string): string | null {
  const m = html.match(/id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i);
  if (!m || !m[1]) return null;
  // Amazon pads the title with leading/trailing whitespace and newlines.
  const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : null;
}

export function extractAmazonImageUrl(html: string): string | null {
  // #landingImage carries data-a-dynamic-image="{...JSON map keyed by URL...}".
  // The keys are the actual image URLs at multiple sizes; values are [w,h].
  // We pick the URL whose declared width is the largest (best quality).
  const m = html.match(/id=["']landingImage["'][^>]*data-a-dynamic-image=["']([^"']+)["']/i);
  if (m && m[1]) {
    try {
      const decoded = decodeHtmlAttr(m[1]);
      const map: Record<string, [number, number]> = JSON.parse(decoded);
      let best: { url: string; w: number } | null = null;
      for (const [url, dims] of Object.entries(map)) {
        const w = Array.isArray(dims) ? Number(dims[0]) : 0;
        if (!best || w > best.w) best = { url, w };
      }
      if (best) return best.url;
    } catch {
      // fall through
    }
  }
  // Fallback: <img id="landingImage" src="...">
  const srcMatch = html.match(/id=["']landingImage["'][^>]*\bsrc=["']([^"']+)["']/i);
  if (srcMatch && srcMatch[1]) return srcMatch[1];
  return null;
}

export function extractAmazonBrand(html: string): string | null {
  // #bylineInfo contains things like "Visit the Ekouaer Store" or
  // "Brand: Acme" or just "Acme". Strip the boilerplate prefix words.
  const m = html.match(/id=["']bylineInfo["'][^>]*>([\s\S]*?)<\/a>/i)
    || html.match(/id=["']bylineInfo["'][^>]*>([\s\S]*?)<\/span>/i);
  if (!m || !m[1]) return null;
  const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  // "Visit the X Store" → "X"; "Brand: X" → "X"
  const visit = text.match(/^Visit the (.+?) Store$/i);
  if (visit && visit[1]) return visit[1].trim();
  const brandPrefix = text.match(/^Brand:\s*(.+)$/i);
  if (brandPrefix && brandPrefix[1]) return brandPrefix[1].trim();
  return text;
}

export function extractAmazonPrice(html: string): string | null {
  // Amazon's accessibility-friendly price text is in `<span class="a-offscreen">$X.XX</span>`.
  // The first occurrence inside the corePrice block is typically the active
  // priceToPay; without DOM scoping, we settle for the first global match
  // which has been the priceToPay value on every modern Amazon /dp/ page
  // we've inspected.
  const m = html.match(/class=["'][^"']*\ba-offscreen\b[^"']*["'][^>]*>\s*(\$[0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*</i);
  if (m && m[1]) return m[1];
  return null;
}

/**
 * Runs the generic parser, then for Amazon hosts overlays Amazon-specific DOM
 * extractors so the result has name/imageUrl/brand/price populated.
 * Non-Amazon hosts pass through unchanged.
 */
function parseAmazonAware(html: string, url: string): ParsedProductMetadata {
  const base = parseProductMetadata(html, url);
  if (!isAmazonHost(url)) return base;

  const amzName = extractAmazonProductTitle(html);
  const amzImage = extractAmazonImageUrl(html);
  const amzBrand = extractAmazonBrand(html);
  const amzPrice = extractAmazonPrice(html);

  // Only override when the Amazon-specific extractor produced a non-empty
  // value; otherwise keep whatever the generic parser found.
  const finalImage = amzImage || base.imageUrl;
  // Keep imageUrls[0] aligned with imageUrl when the Amazon extractor
  // overrides.
  let imageUrls = base.imageUrls;
  if (finalImage) {
    const key = normalizeImageKey(finalImage);
    const rest = base.imageUrls.filter(u => normalizeImageKey(u) !== key);
    imageUrls = [finalImage, ...rest].slice(0, 6);
  } else {
    imageUrls = [];
  }

  const merged: ParsedProductMetadata = {
    name: amzName || base.name,
    brand: amzBrand || base.brand,
    price: amzPrice || base.price,
    imageUrl: finalImage,
    imageUrls,
    description: base.description,
    canonicalUrl: base.canonicalUrl,
    _parserPath: amzName || amzImage ? 'json-ld' : base._parserPath,
  };
  return merged;
}

function toResult(parsed: ParsedProductMetadata, source: string, latencyMs: number, url: string): ProductInfoResult {
  let siteName = parsed.brand;
  if (siteName) {
    siteName = siteName.replace(/\s*(United States|US|USA|UK|Canada)\s*/gi, "").trim() || null;
  }
  if (!siteName) siteName = domainFromUrl(url);

  return {
    name: cleanName(parsed.name),
    brand: parsed.brand ?? null,
    price: parsed.price,
    imageUrl: parsed.imageUrl,
    imageUrls: parsed.imageUrls ?? [],
    originalImageUrl: null,
    description: parsed.description,
    siteName,
    canonicalUrl: parsed.canonicalUrl,
    _source: source,
    _parserPath: parsed._parserPath,
    _latencyMs: latencyMs,
  };
}

type DirectFetchOutcome =
  | { kind: 'ok'; result: ProductInfoResult; httpStatus: number }
  | { kind: 'blocked'; reason: string; detail?: string; httpStatus: number | null }
  | { kind: 'fail'; result: ProductInfoResult; httpStatus: number | null };

/**
 * `fetchUrl` is the URL we hit on the network. `displayUrl` (defaults to
 * `fetchUrl`) is the URL we use when shaping the result — i.e. the value that
 * flows into siteName/canonicalUrl derivation.
 */
async function fetchDirect(fetchUrl: string, displayUrl: string = fetchUrl): Promise<DirectFetchOutcome> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(fetchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    const status = res.status;
    const ct = res.headers.get("content-type") || "";
    const isHtmlish = ct.includes("text/html") || ct.includes("application/xhtml");

    // Read body when we can — needed for both parsing and bot-block detection.
    let body = '';
    if (isHtmlish || !res.ok) {
      try { body = await res.text(); } catch { body = ''; }
    }

    // Bot-block signature check — runs before we decide to parse.
    const signal = detectBotBlock(status, res.headers, body);
    if (signal.isBlocked) {
      return {
        kind: 'blocked',
        reason: signal.reason ?? 'unknown',
        detail: signal.detail,
        httpStatus: status,
      };
    }

    if (!res.ok) {
      return { kind: 'fail', result: { ...NULL_RESULT, _source: 'direct', _latencyMs: Date.now() - t0 }, httpStatus: status };
    }
    if (!isHtmlish) {
      return { kind: 'fail', result: { ...NULL_RESULT, _source: 'direct', _latencyMs: Date.now() - t0 }, httpStatus: status };
    }

    const parsed = parseAmazonAware(body, displayUrl);
    return { kind: 'ok', result: toResult(parsed, 'direct', Date.now() - t0, displayUrl), httpStatus: status };
  } catch {
    clearTimeout(timeout);
    return { kind: 'fail', result: { ...NULL_RESULT, _source: 'direct', _latencyMs: Date.now() - t0 }, httpStatus: null };
  }
}

async function fetchViaScrapingBee(fetchUrl: string, displayUrl: string = fetchUrl): Promise<{ result: ProductInfoResult; httpStatus: number | null }> {
  const apiKey = env.SCRAPINGBEE_API_KEY;
  if (!apiKey) {
    console.warn("[product-info] SCRAPINGBEE_API_KEY not configured");
    return { result: { ...NULL_RESULT, _source: 'scrapingbee' }, httpStatus: null };
  }

  const tryFetch = async (renderJs: boolean): Promise<{ result: ProductInfoResult; httpStatus: number | null } | null> => {
    const t0 = Date.now();
    const params = new URLSearchParams({
      api_key: apiKey,
      url: fetchUrl,
      render_js: renderJs ? "true" : "false",
      premium_proxy: "true",
      block_ads: "true",
      // wait=0 skips ScrapingBee's default 2000ms wait. We don't need
      // animations to play out — we just want HTML for parsing.
      ...(renderJs ? { wait: "0" } : {}),
    });
    const source = renderJs ? 'scrapingbee-js' : 'scrapingbee';
    console.log(`[product-info] ScrapingBee render_js=${renderJs} for ${fetchUrl}`);
    try {
      // 15s timeout — without this, hung ScrapingBee fetches stall the whole
      // request and the client sees a gateway error.
      const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(`[product-info] ScrapingBee ${res.status}: ${body.slice(0, 200)}`);
        if (res.status === 402 || res.status === 403) return null;
        return null;
      }
      const html = await res.text();
      const parsed = parseAmazonAware(html, displayUrl);
      const result = toResult(parsed, source, Date.now() - t0, displayUrl);
      if (isGoodEnough(parsed)) return { result, httpStatus: 200 };
      return null;
    } catch (e: any) {
      console.warn(`[product-info] ScrapingBee error: ${e?.message}`);
      return null;
    }
  };

  const cheap = await tryFetch(false);
  if (cheap) return cheap;

  const full = await tryFetch(true);
  return full ?? { result: { ...NULL_RESULT, _source: 'scrapingbee', _latencyMs: 0 }, httpStatus: null };
}

async function fetchAutoScrapingBeeResult(fetchUrl: string, displayUrl: string = fetchUrl): Promise<{ result: ProductInfoResult; httpStatus: number | null } | null> {
  const t0 = Date.now();
  const html = await fetchViaScrapingBeeAuto(fetchUrl);
  if (!html) return null;
  const parsed = parseAmazonAware(html, displayUrl);
  const result = toResult(parsed, 'scrapingbee-auto', Date.now() - t0, displayUrl);
  if (result.name || result.price || result.imageUrl) {
    return { result, httpStatus: 200 };
  }
  return null;
}

/**
 * Core scrape cascade. Takes a raw (already-normalized) URL, resolves any
 * short URL, runs the layered fallback chain (ScrapingBee-targeted → bot-block
 * cache → direct fetch → ScrapingBee variants) with Amazon-aware parsing, and
 * returns the resolved ProductInfoResult (image cached via finalizeWithCache,
 * Amazon metadata attached).
 */
export async function resolveProductInfo(rawUrl: string, skipCache = false): Promise<ProductInfoResult> {
  const url = await resolveShortUrl(rawUrl);
  if (url !== rawUrl) {
    console.log(`[product-info] Resolved short URL: ${rawUrl} -> ${url}`);
  }

  console.log(`[product-info] Fetching: ${url}`);

  // Amazon hosts: preserve tracking params + extract ASIN.
  const amazon = isAmazonHost(url);
  const amazonTrackingParams = amazon ? pickAmazonTrackingParams(url) : null;
  const amazonAsin = amazon ? extractAsin(url) : null;

  // FETCH-time canonicalization: when the inbound URL is an Amazon /dp/<ASIN>
  // link, fetch the BARE canonical URL only (see canonicalizeAmazonFetchUrl).
  const fetchUrl = canonicalizeAmazonFetchUrl(url);
  if (fetchUrl !== url) {
    console.log(`[product-info] Canonicalized Amazon fetch URL: ${url} -> ${fetchUrl}`);
  }

  function withAmazonMetadata(result: ProductInfoResult): ProductInfoResult {
    if (!amazon) return result;
    // For Amazon hosts, never let canonicalUrl strip params — override with the
    // inbound URL (which retains tracking params) so we don't lose them.
    return {
      ...result,
      canonicalUrl: url,
      metadata: {
        asin: amazonAsin,
        amazonTrackingParams: amazonTrackingParams ?? {},
      },
    };
  }

  // Enrich Shopify candidates BEFORE caching so finalizeWithCache keeps the
  // cached cover at imageUrls[0] and Shopify gallery URLs follow it.
  async function finalize(result: ProductInfoResult): Promise<ProductInfoResult> {
    const enriched = amazon ? result : await enrichWithShopifyGallery(result, url);
    // Fast/preview mode (?cache=0): skip the storage image-cache round-trip
    // (download every image + upload to Supabase Storage) and return raw
    // merchant image URLs. The share sheet renders those directly; durable
    // caching happens at save time. This is the biggest latency win on preview.
    return skipCache ? enriched : finalizeWithCache(enriched);
  }

  // 0) Shopify fast path: the storefront .json is the canonical source (title,
  //    price, and the FULL image gallery) and works even on Cloudflare-protected
  //    Shopify stores (Alo Yoga etc.) via ScrapingBee's residential proxy. When
  //    it hits we skip the slower HTML scrape cascade entirely — faster AND we
  //    get every product photo for the picker.
  if (!amazon) {
    const shopify = await fetchShopifyProduct(url);
    if (shopify && (shopify.images.length > 0 || shopify.title)) {
      const shopResult: ProductInfoResult = {
        ...NULL_RESULT,
        name: cleanName(shopify.title),
        price: shopify.price,
        imageUrl: shopify.images[0] ?? null,
        imageUrls: shopify.images.slice(0, 8),
        siteName: domainFromUrl(url),
        _source: "shopify-json",
        _parserPath: "shopify-json",
      };
      console.log(`[product-info] Shopify-json succeeded (${shopify.images.length} imgs)`);
      return withAmazonMetadata(skipCache ? shopResult : await finalizeWithCache(shopResult));
    }
  }

  // 1) Explicit hardcoded list — keeps existing behavior for known retailers.
  const sbMode = getScrapingBeeMode(fetchUrl);
  if (sbMode) {
    const t0 = Date.now();
    console.log(`[product-info] ScrapingBee-${sbMode} for: ${fetchUrl}`);
    const html = await fetchTargetedScrapingBee(fetchUrl);
    if (html) {
      const parsed = parseAmazonAware(html, url);
      const result = toResult(parsed, `scrapingbee-${sbMode}`, Date.now() - t0, url);
      if (result.name || result.price || result.imageUrl) {
        console.log(`[product-info] ScrapingBee-${sbMode} succeeded (${result._parserPath})`);
        return withAmazonMetadata(await finalize(result));
      }
    }
    const sbFallback: ProductInfoResult = { ...NULL_RESULT, siteName: domainFromUrl(url) };
    console.warn(`[product-info] ScrapingBee-${sbMode} failed for: ${fetchUrl}`);
    return withAmazonMetadata(sbFallback);
  }

  // 2) Auto-detected cache — skip wasted direct fetch for recently-seen
  // bot-blocked domains and go straight to the auto ScrapingBee variant.
  if (isCachedBlocked(fetchUrl)) {
    console.log(`[product-info] cached auto-block hit, using ScrapingBee-auto for: ${fetchUrl}`);
    const auto = await fetchAutoScrapingBeeResult(fetchUrl, url);
    if (auto) {
      console.log(`[product-info] ScrapingBee-auto succeeded (${auto.result._parserPath})`);
      return withAmazonMetadata(await finalize(auto.result));
    }
    // Fall through to the layered ScrapingBee retry below.
    const { result: scraped } = await fetchViaScrapingBee(fetchUrl, url);
    if (scraped.name || scraped.price || scraped.imageUrl) {
      console.log(`[product-info] ScrapingBee succeeded (${scraped._parserPath})`);
      return withAmazonMetadata(await finalize(scraped));
    }
    const fallback: ProductInfoResult = { ...NULL_RESULT, siteName: domainFromUrl(url) };
    console.warn(`[product-info] All methods failed for: ${fetchUrl}`);
    return withAmazonMetadata(fallback);
  }

  // 3) Direct fetch + bot-block detection.
  const direct = await fetchDirect(fetchUrl, url);

  if (direct.kind === 'ok' && direct.result.name && (direct.result.imageUrl || direct.result.price)) {
    console.log(`[product-info] Direct succeeded (${direct.result._parserPath})`);
    return withAmazonMetadata(await finalize(direct.result));
  }

  if (direct.kind === 'blocked' || direct.kind === 'fail') {
    if (direct.kind === 'blocked') {
      console.warn('[productInfo] bot-block detected', {
        url,
        fetchUrl,
        domain: domainFromUrl(url),
        reason: direct.reason,
        detail: direct.detail,
      });
      markCachedBlocked(fetchUrl);
    } else {
      console.warn('[productInfo] direct fetch failed, trying ScrapingBee-auto', {
        url,
        fetchUrl,
        domain: domainFromUrl(url),
      });
    }
    const auto = await fetchAutoScrapingBeeResult(fetchUrl, url);
    if (auto) {
      console.log(`[product-info] ScrapingBee-auto succeeded (${auto.result._parserPath})`);
      return withAmazonMetadata(await finalize(auto.result));
    }
  }

  // 4) Final fallback through the layered ScrapingBee path.
  const { result: scraped } = await fetchViaScrapingBee(fetchUrl, url);
  if (scraped.name || scraped.price || scraped.imageUrl) {
    console.log(`[product-info] ScrapingBee succeeded (${scraped._parserPath})`);
    return withAmazonMetadata(await finalize(scraped));
  }

  // 5) If direct produced a partial result, return it rather than a null.
  if (direct.kind === 'ok') {
    console.log(`[product-info] Direct partial returned (${direct.result._parserPath})`);
    return withAmazonMetadata(await finalize(direct.result));
  }

  const fallback: ProductInfoResult = {
    ...NULL_RESULT,
    siteName: domainFromUrl(url),
  };
  console.warn(`[product-info] All methods failed for: ${fetchUrl}`);
  return withAmazonMetadata(fallback);
}

// ---------------------------------------------------------------------------
// Batch ASIN resolver
// ---------------------------------------------------------------------------

const ASINS_PER_REQUEST_CAP = 12;
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // ~14 days

// Enrichment is delegated to the `enrich-amazon-asin` Edge Function
// (PA-API → Bright Data Web Unlocker → Microlink). Budget is sized for ONE EF
// round-trip, not N: the EF fans its ASINs out in parallel internally.
const ENRICH_EF_NAME = "enrich-amazon-asin";
const ENRICH_CHUNK_SIZE = 10; // EF hard-rejects >10 ("too_many") — chunk to this.
const ENRICH_CHUNK_CONCURRENCY = 2; // parallel chunks within one request (>10 ASINs).
const ENRICH_EF_TIMEOUT_MS = 28_000; // per-chunk EF call deadline (Web Unlocker headroom).
const BATCH_WALL_CLOCK_MS = 30_000; // overall miss-path budget (one EF round-trip + reads).

interface BatchProductInfo {
  asin: string;
  product_name: string | null;
  image_url: string | null;
  product_url: string;
  price: number | null;
}

interface ProductInfoCacheRow {
  asin: string;
  product_name: string | null;
  image_url: string | null;
  product_url: string | null;
  price: number | string | null;
  currency: string | null;
  brand_name: string | null;
  source: string | null;
  fetched_at: string | null;
}

function amazonUrlForAsin(asin: string): string {
  return `https://www.amazon.com/dp/${asin}`;
}

/**
 * Parse the scraper's price string ("$1,299.99") into a numeric value.
 */
function parsePriceToNumber(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function rowToBatchInfo(row: ProductInfoCacheRow): BatchProductInfo {
  const priceNum =
    typeof row.price === "number"
      ? row.price
      : typeof row.price === "string"
        ? parsePriceToNumber(row.price)
        : null;
  return {
    asin: row.asin,
    product_name: row.product_name ?? null,
    image_url: row.image_url ?? null,
    product_url: row.product_url ?? amazonUrlForAsin(row.asin),
    price: priceNum,
  };
}

function isFreshCacheRow(row: ProductInfoCacheRow): boolean {
  if (!row.image_url) return false;
  if (!row.fetched_at) return false;
  const fetchedMs = Date.parse(row.fetched_at);
  if (Number.isNaN(fetchedMs)) return false;
  return Date.now() - fetchedMs < CACHE_TTL_MS;
}

function parseAsinsParam(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const asin = part.trim().toUpperCase();
    if (!asin) continue;
    if (seen.has(asin)) continue;
    seen.add(asin);
    out.push(asin);
    if (out.length >= ASINS_PER_REQUEST_CAP) break;
  }
  return out;
}

interface AmazonProductCacheRow {
  asin: string;
  title: string | null;
  image_url: string | null;
  detail_page_url: string | null;
  fetch_status: string | null;
}

interface EnrichVia {
  paapi: number;
  brightdata: number;
  microlink: number;
}

/**
 * Invoke the `enrich-amazon-asin` Edge Function for one chunk of ASINs (≤10).
 * The EF resolves each ASIN (PA-API → Bright Data → Microlink) and writes the
 * result into `amazon_product_cache` BEFORE responding. Returns the EF's `via`
 * provider counts or null on timeout / error — fail-soft.
 */
async function enrichChunkViaEf(asins: string[]): Promise<EnrichVia | null> {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENRICH_EF_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/functions/v1/${ENRICH_EF_NAME}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ asins }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[product-info/batch] enrich EF ${res.status} for ${asins.length} asins`);
      return null;
    }
    const body: any = await res.json().catch(() => null);
    const via = body?.via ?? {};
    return {
      paapi: Number(via.paapi ?? 0),
      brightdata: Number(via.brightdata ?? 0),
      microlink: Number(via.microlink ?? 0),
    };
  } catch (e: any) {
    console.warn(`[product-info/batch] enrich EF failed: ${e?.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read `amazon_product_cache` (the EF's output table) for the given ASINs and
 * return only the rows the EF has marked `complete` with usable data.
 */
async function readAmazonCache(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  asins: string[],
): Promise<Map<string, BatchProductInfo>> {
  const out = new Map<string, BatchProductInfo>();
  if (asins.length === 0) return out;
  const { data, error } = await supabase
    .from("amazon_product_cache")
    .select("asin, title, image_url, detail_page_url, fetch_status")
    .in("asin", asins);
  if (error) {
    console.warn(`[product-info/batch] amazon_product_cache read failed: ${error.message}`);
    return out;
  }
  for (const row of (data ?? []) as AmazonProductCacheRow[]) {
    if (row.fetch_status !== "complete") continue;
    if (!row.image_url && !row.title) continue;
    out.set(row.asin, {
      asin: row.asin,
      product_name: row.title ?? null,
      image_url: row.image_url ?? null,
      product_url: row.detail_page_url ?? amazonUrlForAsin(row.asin),
      price: null, // amazon_product_cache carries no price; image + name are the goal.
    });
  }
  return out;
}

/**
 * Mirror EF-resolved products into product_info_cache (the primary read cache)
 * so subsequent batch calls serve them instantly. Only rows with an image are
 * mirrored, so we never clobber a good pre-seeded row with an empty one.
 */
async function mirrorToProductInfoCache(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  infos: BatchProductInfo[],
): Promise<void> {
  const rows = infos
    .filter((i) => i.image_url)
    .map((i) => ({
      asin: i.asin,
      product_name: i.product_name,
      image_url: i.image_url,
      product_url: i.product_url,
      price: i.price,
      source: "enrich_amazon_asin",
      fetched_at: new Date().toISOString(),
    }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("product_info_cache")
    .upsert(rows, { onConflict: "asin" });
  if (error) {
    console.warn(`[product-info/batch] mirror upsert failed: ${error.message}`);
  }
}

async function handleAsinBatch(sp: URLSearchParams): Promise<Response> {
  const asins = parseAsinsParam(sp.get("asins") ?? undefined);
  if (asins.length === 0) {
    return json(
      { error: { message: "asins query param required", code: "VALIDATION_ERROR" } },
      400,
    );
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return json(
      { error: { message: "Database unavailable", code: "DB_UNAVAILABLE" } },
      503,
    );
  }

  // 1) Single bulk read of the cache for all requested ASINs.
  const cacheByAsin = new Map<string, ProductInfoCacheRow>();
  const { data: cacheRows, error: cacheError } = await supabase
    .from("product_info_cache")
    .select(
      "asin, product_name, image_url, product_url, price, currency, brand_name, source, fetched_at",
    )
    .in("asin", asins);
  if (cacheError) {
    console.error("[product-info/batch] cache read failed", cacheError.message);
    return json({ error: { message: "Query failed", code: "QUERY_FAILED" } }, 500);
  }
  for (const row of (cacheRows ?? []) as ProductInfoCacheRow[]) {
    cacheByAsin.set(row.asin, row);
  }

  // 2) Partition into fresh cache hits vs. ASINs that need scraping.
  const resolved = new Map<string, BatchProductInfo>();
  const toScrape: string[] = [];
  for (const asin of asins) {
    const row = cacheByAsin.get(asin);
    if (row && isFreshCacheRow(row)) {
      resolved.set(asin, rowToBatchInfo(row));
    } else {
      toScrape.push(asin);
    }
  }

  // 3) Resolve misses via the enrich-amazon-asin EF, bounded by an overall
  //    wall-clock so a cold batch can finish without hanging.
  let scrapedCount = 0;
  const via: EnrichVia = { paapi: 0, brightdata: 0, microlink: 0 };
  if (toScrape.length > 0) {
    const deadlineAt = Date.now() + BATCH_WALL_CLOCK_MS;

    // 3a) Some misses may already be `complete` in amazon_product_cache from a
    //     prior view — use those with no EF call, and mirror them.
    const preCache = await readAmazonCache(supabase, toScrape);
    const stillMissing: string[] = [];
    const preMirror: BatchProductInfo[] = [];
    for (const asin of toScrape) {
      const hit = preCache.get(asin);
      if (hit) {
        resolved.set(asin, hit);
        preMirror.push(hit);
        scrapedCount++;
      } else {
        stillMissing.push(asin);
      }
    }
    await mirrorToProductInfoCache(supabase, preMirror);

    // 3b) Enrich the remainder via the EF. Chunk to ≤10 (EF hard limit) and run
    //     a couple of chunks in parallel; the EF writes amazon_product_cache
    //     synchronously, so we read each chunk back right after its call.
    if (stillMissing.length > 0 && Date.now() < deadlineAt) {
      const chunks: string[][] = [];
      for (let i = 0; i < stillMissing.length; i += ENRICH_CHUNK_SIZE) {
        chunks.push(stillMissing.slice(i, i + ENRICH_CHUNK_SIZE));
      }
      let cursor = 0;
      const chunkRunner = async (): Promise<void> => {
        while (cursor < chunks.length && Date.now() < deadlineAt) {
          const chunk = chunks[cursor++]!;
          const chunkVia = await enrichChunkViaEf(chunk);
          if (chunkVia) {
            via.paapi += chunkVia.paapi;
            via.brightdata += chunkVia.brightdata;
            via.microlink += chunkVia.microlink;
          }
          const after = await readAmazonCache(supabase, chunk);
          const mirror: BatchProductInfo[] = [];
          for (const asin of chunk) {
            const hit = after.get(asin);
            if (hit) {
              resolved.set(asin, hit);
              mirror.push(hit);
              scrapedCount++;
            }
          }
          await mirrorToProductInfoCache(supabase, mirror);
        }
      };
      const runners = Array.from(
        { length: Math.min(ENRICH_CHUNK_CONCURRENCY, chunks.length) },
        () => chunkRunner(),
      );
      await Promise.all(runners);
    }
  }

  // 4) Ensure every requested ASIN is present (null-field tile if unresolved).
  const data: BatchProductInfo[] = asins.map(
    (asin) =>
      resolved.get(asin) ?? {
        asin,
        product_name: null,
        image_url: null,
        product_url: amazonUrlForAsin(asin),
        price: null,
      },
  );

  const servedFromCache = asins.length - toScrape.length;
  const dropped = data.filter(
    (d) => d.image_url == null && d.product_name == null && d.price == null,
  ).length;
  console.log(
    `[product-info/batch] requested=${asins.length} cache=${servedFromCache} ` +
      `enriched=${scrapedCount} dropped=${dropped} ` +
      `via=paapi:${via.paapi},bd:${via.brightdata},ml:${via.microlink}`,
  );

  return json({ data });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json({ error: { message: "Not found", code: "NOT_FOUND" } }, 404);
  }

  const sp = new URL(req.url).searchParams;

  // Batch ASIN branch: when `?asins=` is present, delegate to the batch resolver
  // and return immediately so the `?url=` behavior is untouched.
  if (sp.get("asins") !== null) {
    return handleAsinBatch(sp);
  }

  const rawUrl = sp.get("url") ?? undefined;
  const normalized = normalizeUrlInput(rawUrl);
  if (!normalized) {
    return json({ error: { message: "url query param is required", code: "VALIDATION_ERROR" } }, 400);
  }

  // ?cache=0 (or ?preview=1) skips durable image caching for a fast preview.
  const skipCache = sp.get("cache") === "0" || sp.get("preview") === "1";
  const result = await resolveProductInfo(normalized, skipCache);
  return json({ data: result });
});
