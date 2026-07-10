// cacheMerchantImage — edge-runtime port of backend/src/lib/cacheMerchantImage.ts
// (Vibecode migration, 2026-07-09). Two deliberate changes from the Bun original:
//  1. Buffer → Uint8Array (no Node Buffer in the edge runtime).
//  2. The HTTP/1.1 fallback no longer shells out to curl (no subprocesses in
//     edge functions). The original fallback existed because BUN's fetch forces
//     HTTP/2, which some WAF'd CDNs (e.g. Gucci's) reject; Deno's fetch
//     negotiates protocol normally, so the primary fetch already covers most of
//     those. The fallback here retries with the full Chrome client-hint
//     fingerprint (the other half of what those WAFs check). If a CDN still
//     refuses, behavior degrades exactly like the original's failure path:
//     the merchant URL passes through uncached (item save never breaks).

import { getSupabaseAdmin, sha256Hex } from "./_shared.ts";

const BUCKET = "item-photos";
const CACHE_PREFIX = "cache";
const FETCH_TIMEOUT_MS = 8000;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// Don't list image/avif — downstream image processors (e.g. Photoroom ghost-
// mannequin) handle JPEG/PNG/WebP reliably, AVIF less so. Akamai is happy
// with this list as long as the rest of the browser fingerprint is present.
const BROWSER_ACCEPT = "image/webp,image/png,image/jpeg,image/*,*/*;q=0.8";
const BROWSER_ACCEPT_LANGUAGE = "en-US,en;q=0.9";

const CONTENT_TYPE_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function extFromContentType(ct: string | null): string {
  if (!ct) return "jpg";
  const base = ct.split(";")[0]!.trim().toLowerCase();
  return CONTENT_TYPE_TO_EXT[base] ?? "jpg";
}

export type CacheResult = {
  photo_url: string;
  original_photo_url: string | null;
};

type FetchedImage = {
  bytes: Uint8Array;
  contentType: string | null;
};

async function fetchBasic(url: string): Promise<FetchedImage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: BROWSER_ACCEPT,
        "Accept-Language": BROWSER_ACCEPT_LANGUAGE,
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`http_${res.status}`);
    }
    const contentType = res.headers.get("content-type");
    const arrayBuffer = await res.arrayBuffer();
    return { bytes: new Uint8Array(arrayBuffer), contentType };
  } finally {
    clearTimeout(timeout);
  }
}

// Fingerprinted retry — for CDNs whose WAF rejects the plain fetch. Sends the
// full Chrome sec-ch-ua / Sec-Fetch header set plus a same-site Referer, which
// is what the curl fallback in the Bun original supplied.
async function fetchFingerprinted(url: string): Promise<FetchedImage> {
  const referer = (() => {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host}/`;
    } catch {
      return url;
    }
  })();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: BROWSER_ACCEPT,
        "Accept-Language": BROWSER_ACCEPT_LANGUAGE,
        "sec-ch-ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "Sec-Fetch-Dest": "image",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Site": "same-site",
        Referer: referer,
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`http_${res.status}`);
    }
    const contentType = res.headers.get("content-type");
    const arrayBuffer = await res.arrayBuffer();
    return { bytes: new Uint8Array(arrayBuffer), contentType };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchImageWithFallback(merchantUrl: string): Promise<FetchedImage> {
  try {
    return await fetchBasic(merchantUrl);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[cacheMerchantImage] plain fetch failed (${reason}); retrying with browser fingerprint for ${merchantUrl}`);
    return await fetchFingerprinted(merchantUrl);
  }
}

/**
 * Fetches a merchant image URL and caches it to Supabase Storage so the URL we
 * serve never decays (merchant CDNs change paths, hotlink-block, take products
 * down). Dedupes by sha256(merchantUrl) — same source URL across creators
 * resolves to one stored object.
 *
 * Failure is non-fatal: returns the merchant URL with original_photo_url=null
 * so the calling route can still respond. Item save must NOT break.
 */
export async function cacheMerchantImage(merchantUrl: string): Promise<CacheResult> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.warn("[cacheMerchantImage] supabase admin not configured; passing merchant URL through");
    return { photo_url: merchantUrl, original_photo_url: null };
  }

  try {
    const hash = await sha256Hex(merchantUrl);

    // If anything for this hash is already cached (regardless of extension),
    // reuse it without refetching.
    try {
      const { data: existing } = await supabase.storage.from(BUCKET).list(CACHE_PREFIX, {
        limit: 5,
        search: hash,
      });
      const hit = (existing ?? []).find((f: { name: string }) => f.name.startsWith(`${hash}.`));
      if (hit) {
        const publicUrl = supabase.storage
          .from(BUCKET)
          .getPublicUrl(`${CACHE_PREFIX}/${hit.name}`).data.publicUrl;
        return { photo_url: publicUrl, original_photo_url: merchantUrl };
      }
    } catch {
      // non-fatal; fall through to fetch+upload
    }

    const { bytes, contentType } = await fetchImageWithFallback(merchantUrl);
    const ext = extFromContentType(contentType);
    const path = `${CACHE_PREFIX}/${hash}.${ext}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: contentType ?? `image/${ext === "jpg" ? "jpeg" : ext}`,
      upsert: true,
    });
    if (uploadError) {
      console.warn(`[cacheMerchantImage] upload failed: ${uploadError.message}`);
      return { photo_url: merchantUrl, original_photo_url: null };
    }

    const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    return { photo_url: publicUrl, original_photo_url: merchantUrl };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[cacheMerchantImage] exception for ${merchantUrl}: ${reason}`);
    return { photo_url: merchantUrl, original_photo_url: null };
  }
}
