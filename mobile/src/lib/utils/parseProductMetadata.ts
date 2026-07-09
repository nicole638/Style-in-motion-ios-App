import { decodeHtmlEntities } from '../decode-entities';

export interface ParsedProductMetadata {
  name: string | null;
  brand: string | null;
  price: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  description: string | null;
  canonicalUrl: string | null;
  _parserPath: 'json-ld' | 'og' | 'twitter' | 'title-fallback' | 'none';
}

const EMPTY: ParsedProductMetadata = {
  name: null, brand: null, price: null, imageUrl: null, imageUrls: [],
  description: null, canonicalUrl: null, _parserPath: 'none',
};

const MAX_IMAGE_CANDIDATES = 6;

// --------------- JSON-LD (Priority 1) ---------------

function extractJsonLdBlocks(html: string): any[] {
  const out: any[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      const p = JSON.parse(m[1]!.trim());
      if (Array.isArray(p)) out.push(...p);
      else if (p['@graph'] && Array.isArray(p['@graph'])) out.push(...p['@graph']);
      else out.push(p);
    } catch { /* skip malformed */ }
  }
  return out;
}

function findProduct(ld: any[]): any | null {
  return ld.find(o =>
    o['@type'] === 'Product' ||
    (Array.isArray(o['@type']) && o['@type'].includes('Product'))
  ) ?? null;
}

function extractFromJsonLd(html: string): Partial<ParsedProductMetadata> {
  const blocks = extractJsonLdBlocks(html);
  const product = findProduct(blocks);
  if (!product) return {};

  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;

  let brandStr: string | null = null;
  if (product.brand) {
    brandStr = typeof product.brand === 'string' ? product.brand
      : product.brand?.name ?? null;
  }

  let imageStr: string | null = null;
  const rawImage = product.image ?? offers?.image ?? null;
  if (typeof rawImage === 'string') imageStr = rawImage;
  else if (Array.isArray(rawImage) && rawImage.length > 0) {
    imageStr = typeof rawImage[0] === 'string' ? rawImage[0] : rawImage[0]?.url ?? null;
  } else if (rawImage?.url) imageStr = rawImage.url;

  let rawPrice = offers?.price ?? offers?.priceSpecification?.price ?? null;
  let priceStr: string | null = null;
  if (rawPrice != null) {
    const num = Number(rawPrice);
    if (!isNaN(num)) {
      priceStr = Number.isInteger(num) ? `$${num}` : `$${num.toFixed(2)}`;
    }
  }

  return {
    name: product.name ?? null,
    brand: brandStr,
    price: priceStr,
    imageUrl: imageStr,
    description: product.description ?? null,
  };
}

// --------------- OG tags (Priority 2) ---------------

function getMetaContent(head: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']` +
    `|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'i'
  );
  const m = head.match(re);
  return m ? (m[1] || m[2] || null) : null;
}

function getAllMetaContent(head: string, property: string): string[] {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']` +
    `|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    'gi'
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(head)) !== null) {
    const v = m[1] || m[2];
    if (v) out.push(v);
  }
  return out;
}

function extractFromOg(head: string): Partial<ParsedProductMetadata> {
  const name = getMetaContent(head, 'og:title') ?? null;
  const image = getMetaContent(head, 'og:image') ?? null;
  const description = getMetaContent(head, 'og:description') ?? null;
  const brand = getMetaContent(head, 'product:brand') ?? getMetaContent(head, 'og:site_name') ?? null;
  const priceAmount = getMetaContent(head, 'product:price:amount') ?? null;
  let price: string | null = null;
  if (priceAmount) {
    const num = Number(priceAmount);
    if (!isNaN(num)) price = Number.isInteger(num) ? `$${num}` : `$${num.toFixed(2)}`;
    else price = priceAmount;
  }
  if (!price && description) price = extractPriceFromText(description);
  return { name, brand, price, imageUrl: image, description };
}

// --------------- Twitter cards (Priority 3) ---------------

function extractFromTwitter(head: string): Partial<ParsedProductMetadata> {
  return {
    name: getMetaContent(head, 'twitter:title') ?? null,
    imageUrl: getMetaContent(head, 'twitter:image') ?? null,
    description: getMetaContent(head, 'twitter:description') ?? null,
  };
}

// --------------- Title/meta fallback (Priority 4) ---------------

function extractFromTitle(head: string): Partial<ParsedProductMetadata> {
  const titleMatch = head.match(/<title[^>]*>([^<]+)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1]!.trim() : null;
  let name: string | null = null;
  let brand: string | null = null;
  if (pageTitle) {
    const pipeIdx = pageTitle.indexOf('|');
    const dashIdx = pageTitle.indexOf('\u2014');
    const sepIdx = pipeIdx !== -1 ? pipeIdx : dashIdx;
    if (sepIdx !== -1) {
      name = pageTitle.substring(0, sepIdx).trim() || null;
      const after = pageTitle.substring(sepIdx + 1).trim();
      if (after.length > 1) brand = after;
    } else {
      const colonIdx = pageTitle.indexOf(':');
      if (colonIdx !== -1) {
        const after = pageTitle.substring(colonIdx + 1).trim();
        if (after.length > 3) name = after;
      } else {
        name = pageTitle;
      }
    }
  }
  const desc = getMetaContent(head, 'description') ?? null;
  return { name, brand, description: desc };
}

// --------------- Canonical URL ---------------

function extractCanonicalUrl(head: string): string | null {
  const m = head.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || head.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  return m ? m[1] ?? null : null;
}

// --------------- Helpers ---------------

function extractPriceFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = String(text).match(/\$[\d,]+\.?\d{0,2}/);
  return match ? match[0] : null;
}

function isJunkImage(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.startsWith('data:') ||
    lower.includes('1x1') ||
    lower.includes('pixel') ||
    lower.includes('spacer') ||
    lower.includes('banner') ||
    lower.includes('promo') ||
    lower.includes('swatch') ||
    lower.includes('_small') ||
    lower.includes('_compact') ||
    lower.includes('_pico') ||
    lower.includes('50x') ||
    lower.includes('100x')
  );
}

// --------------- Image candidates (multi-image picker) ---------------

function extractJsonLdImageList(html: string): string[] {
  const blocks = extractJsonLdBlocks(html);
  const product = findProduct(blocks);
  if (!product) return [];
  const out: string[] = [];
  const collect = (raw: any) => {
    if (!raw) return;
    if (typeof raw === 'string') { out.push(raw); return; }
    if (Array.isArray(raw)) { for (const r of raw) collect(r); return; }
    if (typeof raw === 'object') {
      const v = raw.url ?? raw.contentUrl ?? raw['@id'] ?? null;
      if (typeof v === 'string') out.push(v);
    }
  };
  collect(product.image);
  const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
  collect(offers?.image);
  return out;
}

function extractLinkImageSrc(head: string): string[] {
  const re = /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']|<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["']/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(head)) !== null) {
    const v = m[1] || m[2];
    if (v) out.push(v);
  }
  return out;
}

function extractItempropImages(html: string): string[] {
  const out: string[] = [];
  const reA = /<[^>]+itemprop=["']image["'][^>]*\b(?:src|href|content)=["']([^"']+)["']/gi;
  const reB = /<[^>]+\b(?:src|href|content)=["']([^"']+)["'][^>]+itemprop=["']image["']/gi;
  let m: RegExpExecArray | null;
  while ((m = reA.exec(html)) !== null) { if (m[1]) out.push(m[1]); }
  while ((m = reB.exec(html)) !== null) { if (m[1]) out.push(m[1]); }
  return out;
}

function absolutize(url: string, base: string): string {
  if (!base) return url;
  try { return new URL(url, base).href; } catch { return url; }
}

function coerceHttps(url: string): string {
  return url.startsWith('http://') ? 'https://' + url.slice(7) : url;
}

export function normalizeImageKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return url.toLowerCase();
  }
}

function dedupeImages(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const key = normalizeImageKey(u);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

function buildImageCandidates(html: string, head: string, sourceUrl: string): string[] {
  const raw = [
    ...extractJsonLdImageList(html),
    ...getAllMetaContent(head, 'og:image'),
    ...getAllMetaContent(head, 'og:image:secure_url'),
    ...getAllMetaContent(head, 'og:image:url'),
    ...getAllMetaContent(head, 'twitter:image'),
    ...getAllMetaContent(head, 'twitter:image:src'),
    ...extractLinkImageSrc(head),
    ...extractItempropImages(html),
  ];
  const cleaned = raw
    .map(u => (u ?? '').trim())
    .filter(u => u.length > 0 && !u.toLowerCase().startsWith('data:'))
    .map(u => absolutize(u, sourceUrl))
    .map(coerceHttps)
    .map(u => decodeHtmlEntities(u) ?? u);
  return dedupeImages(cleaned).slice(0, MAX_IMAGE_CANDIDATES);
}

// --------------- Main cascade ---------------

export function parseProductMetadata(html: string, sourceUrl: string = ''): ParsedProductMetadata {
  const headEnd = html.indexOf('</head>');
  const head = headEnd !== -1 ? html.substring(0, headEnd) : html.substring(0, 30000);

  const jsonLd = extractFromJsonLd(html);
  const og = extractFromOg(head);
  const twitter = extractFromTwitter(head);
  const title = extractFromTitle(head);

  const layers: Partial<ParsedProductMetadata>[] = [jsonLd, og, twitter, title];

  function firstNonEmpty(field: keyof ParsedProductMetadata): string | null {
    for (const layer of layers) {
      const v = layer[field];
      if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    }
    return null;
  }

  let parserPath: ParsedProductMetadata['_parserPath'] = 'none';
  if (jsonLd.name) parserPath = 'json-ld';
  else if (og.name) parserPath = 'og';
  else if (twitter.name) parserPath = 'twitter';
  else if (title.name) parserPath = 'title-fallback';

  let imageUrl = firstNonEmpty('imageUrl');
  if (imageUrl && isJunkImage(imageUrl)) imageUrl = null;
  if (imageUrl) {
    imageUrl = absolutize(imageUrl, sourceUrl);
    imageUrl = coerceHttps(imageUrl);
  }

  const candidates = buildImageCandidates(html, head, sourceUrl);
  let imageUrls: string[];
  if (imageUrl) {
    const decoded = decodeHtmlEntities(imageUrl) ?? imageUrl;
    const key = normalizeImageKey(decoded);
    const rest = candidates.filter(u => normalizeImageKey(u) !== key && !isJunkImage(u));
    imageUrls = [decoded, ...rest].slice(0, MAX_IMAGE_CANDIDATES);
  } else {
    imageUrls = candidates.filter(u => !isJunkImage(u)).slice(0, MAX_IMAGE_CANDIDATES);
  }

  const canonicalUrl = extractCanonicalUrl(head);

  const decode = (s: string | null): string | null => (s ? decodeHtmlEntities(s) : s);

  return {
    name: decode(firstNonEmpty('name')),
    brand: decode(firstNonEmpty('brand')),
    price: firstNonEmpty('price'),
    imageUrl: decode(imageUrl),
    imageUrls,
    description: decode(firstNonEmpty('description')),
    canonicalUrl: decode(canonicalUrl),
    _parserPath: parserPath,
  };
}

export function isGoodEnough(result: ParsedProductMetadata): boolean {
  return !!result.name && (!!result.imageUrl || !!result.price);
}
