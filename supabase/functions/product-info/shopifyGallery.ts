// Shopify exposes a JSON view of every product at `<origin>/products/<handle>.json`
// (the storefront feed). On JSON-LD-only stores the parser sees just a single
// `image` field, even though the product page renders 5-10 photos. We hit the
// JSON endpoint to recover the full gallery for the multi-image picker.
//
// Mirrors what scrape-product v13 does on the async path so the synchronous
// /api/product-info route reaches parity on Shopify merchants (Bolsa Nova,
// Burton Goods, Camilla Gabrieli, Los Angeles Apparel, and most modern
// boutiques on Awin).

import { normalizeImageKey } from "./parseProductMetadata.ts";

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

interface ShopifyProductJson {
  product?: {
    images?: Array<{ src?: string | null }> | null;
  };
}

/**
 * Returns the list of image URLs from `<origin>/products/<handle>.json`, in the
 * order Shopify lists them. Returns [] on any failure (404, non-JSON, timeout,
 * non-Shopify response). Tolerant by design — this is enrichment-only, the
 * caller must still have a usable result if this returns nothing.
 */
export async function fetchShopifyGalleryUrls(url: string, timeoutMs: number = 4000): Promise<string[]> {
  const parsed = extractShopifyHandle(url);
  if (!parsed) return [];

  const target = `${parsed.origin}/products/${parsed.handle}.json`;
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
    if (!res.ok) return [];
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return [];
    const body = (await res.json()) as ShopifyProductJson;
    const imgs = body?.product?.images ?? [];
    const out: string[] = [];
    for (const img of imgs) {
      const src = (img?.src ?? "").trim();
      if (!src) continue;
      const https = src.startsWith("http://") ? "https://" + src.slice(7) : src;
      out.push(https);
    }
    return out;
  } catch {
    clearTimeout(timer);
    return [];
  }
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
  max: number = 6,
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
