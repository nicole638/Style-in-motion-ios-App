// Shopify exposes a JSON view of every product at `<origin>/products/<handle>.json`
// (the storefront feed) with the FULL gallery, title, and price. On JSON-LD-only
// stores the HTML parser sees just a single `image` field even though the page
// renders 5-10 photos, so we hit the JSON endpoint to recover the whole gallery
// for the multi-image picker.
//
// Some Shopify stores sit behind Cloudflare/Akamai (e.g. Alo Yoga) which 503s a
// plain server fetch of the .json. In that case we retry through ScrapingBee's
// residential proxy (render_js off, so JSON stays JSON). This makes the full
// gallery reachable for protected Shopify merchants too.

import { normalizeImageKey } from "./parseProductMetadata.ts";
import { fetchRawViaScrapingBee } from "./scrapingbee.ts";

const PRODUCTS_PATH_RE = /^\/products\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:[/?#]|$)/;

export function extractShopifyHandle(url: string): { origin: string; handle: string } | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(PRODUCTS_PATH_RE);
    if (!m || !m[1]) return null;
    return { origin: `${u.protocol}//${u.host}`, handle: m[1] };
  } catch {
    return null;
  }
}

export interface ShopifyProduct {
  title: string | null;
  price: string | null;
  images: string[];
}

interface ShopifyProductJson {
  product?: {
    title?: string | null;
    images?: Array<{ src?: string | null }> | null;
    variants?: Array<{ price?: string | number | null }> | null;
  };
}

function parseShopifyJson(text: string): ShopifyProduct | null {
  let body: ShopifyProductJson;
  try {
    body = JSON.parse(text) as ShopifyProductJson;
  } catch {
    return null;
  }
  const p = body?.product;
  if (!p) return null;

  const images: string[] = [];
  for (const img of p.images ?? []) {
    const src = (img?.src ?? "").trim();
    if (!src) continue;
    images.push(src.startsWith("http://") ? "https://" + src.slice(7) : src);
  }

  // Price from the first variant that has one.
  let price: string | null = null;
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const v = variants.find((x) => x && x.price != null) ?? variants[0];
  if (v && v.price != null) {
    const num = parseFloat(String(v.price));
    if (Number.isFinite(num)) price = num % 1 === 0 ? `$${num}` : `$${num.toFixed(2)}`;
  }

  const title = (p.title ?? "").trim() || null;
  return { title, price, images };
}

/**
 * Fetch a Shopify product's canonical data (title, price, full image gallery)
 * from the storefront .json. Tries a direct fetch first (fast, works on
 * unprotected stores); on block/non-JSON, retries through ScrapingBee's
 * residential proxy. Returns null for non-Shopify URLs or on total failure.
 */
export async function fetchShopifyProduct(url: string, timeoutMs = 4000): Promise<ShopifyProduct | null> {
  const parsed = extractShopifyHandle(url);
  if (!parsed) return null;
  const target = `${parsed.origin}/products/${parsed.handle}.json`;

  // 1) Direct — fast path for unprotected Shopify stores.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(target, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; Vibecode/1.0)",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (res.ok && (res.headers.get("content-type") || "").includes("application/json")) {
      const parsedJson = parseShopifyJson(await res.text());
      if (parsedJson && (parsedJson.images.length || parsedJson.title)) return parsedJson;
    }
  } catch {
    clearTimeout(timer);
  }

  // 2) Fall back to ScrapingBee's residential proxy (Cloudflare/Akamai-protected
  //    Shopify stores like Alo Yoga block the plain fetch above).
  const raw = await fetchRawViaScrapingBee(target);
  if (raw) {
    const parsedJson = parseShopifyJson(raw);
    if (parsedJson && (parsedJson.images.length || parsedJson.title)) return parsedJson;
  }
  return null;
}

/**
 * Back-compat wrapper: returns just the gallery image URLs.
 */
export async function fetchShopifyGalleryUrls(url: string, timeoutMs = 4000): Promise<string[]> {
  const p = await fetchShopifyProduct(url, timeoutMs);
  return p?.images ?? [];
}

/**
 * Merges Shopify gallery URLs into an existing imageUrls list. The original
 * cover (imageUrls[0] / imageUrl) is preserved at the front; remaining
 * candidates from the gallery are appended, deduped by normalized key, and
 * the whole list is capped at `max`.
 */
export function mergeGalleryIntoCandidates(
  existing: string[],
  gallery: string[],
  max = 8,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of [...existing, ...gallery]) {
    if (!u) continue;
    const key = normalizeImageKey(u);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}
