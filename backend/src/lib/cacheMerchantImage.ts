import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "./supabase";

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
  bytes: Buffer;
  contentType: string | null;
};

async function fetchH2(url: string): Promise<FetchedImage> {
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
    return { bytes: Buffer.from(arrayBuffer), contentType };
  } finally {
    clearTimeout(timeout);
  }
}

// HTTP/1.1 fallback via curl — for CDNs (e.g. Gucci) whose WAF rejects HTTP/2
// client fingerprints with INTERNAL_ERROR. Bun's fetch defaults to HTTP/2 with
// no flag to force 1.1, so we shell out. -D - dumps response headers to stdout
// before the body so we can recover Content-Type.
async function fetchH1(url: string): Promise<FetchedImage> {
  const referer = (() => {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host}/`;
    } catch {
      return url;
    }
  })();

  const proc = Bun.spawn(
    [
      "curl",
      "--http1.1",
      "--compressed",
      "-sS",
      "-L",
      "--max-time",
      String(Math.ceil(FETCH_TIMEOUT_MS / 1000)),
      "-D",
      "-",
      "-A",
      BROWSER_UA,
      "-H",
      `Accept: ${BROWSER_ACCEPT}`,
      "-H",
      `Accept-Language: ${BROWSER_ACCEPT_LANGUAGE}`,
      // Akamai/WAF fingerprint match — without these, the server stalls instead
      // of replying. Match a current Chrome on macOS. Accept-Encoding is set by
      // --compressed (which also handles decompression).
      "-H",
      'sec-ch-ua: "Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "-H",
      "sec-ch-ua-mobile: ?0",
      "-H",
      'sec-ch-ua-platform: "macOS"',
      "-H",
      "Sec-Fetch-Dest: image",
      "-H",
      "Sec-Fetch-Mode: no-cors",
      "-H",
      "Sec-Fetch-Site: same-site",
      "-H",
      `Referer: ${referer}`,
      url,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`curl_exit_${exitCode}: ${stderr.trim().slice(0, 200)}`);
  }

  const buf = Buffer.from(stdout);

  // Find the final blank line separating the last header block from the body.
  // -L means we may see multiple header blocks (one per redirect hop), so scan
  // from the end for the LAST occurrence.
  let bodyStart = -1;
  let lastHeaderEnd = -1;
  for (let i = 0; i + 3 < buf.length; i++) {
    if (
      buf[i] === 0x0d /* \r */ &&
      buf[i + 1] === 0x0a /* \n */ &&
      buf[i + 2] === 0x0d &&
      buf[i + 3] === 0x0a
    ) {
      lastHeaderEnd = i;
      bodyStart = i + 4;
    }
  }
  if (bodyStart < 0) {
    throw new Error("curl_no_header_terminator");
  }

  const headerText = buf.subarray(0, lastHeaderEnd).toString("utf8");
  const lines = headerText.split(/\r?\n/);
  // Status line of the LAST response block (after the last "HTTP/" line).
  let statusLineIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.startsWith("HTTP/")) {
      statusLineIdx = i;
      break;
    }
  }
  if (statusLineIdx < 0) {
    throw new Error("curl_no_status_line");
  }
  const statusParts = lines[statusLineIdx]!.split(" ");
  const status = Number(statusParts[1] ?? 0);
  if (status < 200 || status >= 300) {
    throw new Error(`http_${status}`);
  }

  let contentType: string | null = null;
  for (let i = statusLineIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (key === "content-type") {
      contentType = line.slice(colon + 1).trim();
      break;
    }
  }

  return { bytes: buf.subarray(bodyStart), contentType };
}

async function fetchImageWithFallback(merchantUrl: string): Promise<FetchedImage> {
  try {
    return await fetchH2(merchantUrl);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[cacheMerchantImage] h2 failed (${reason}); retrying http/1.1 for ${merchantUrl}`);
    return await fetchH1(merchantUrl);
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
    const hash = createHash("sha256").update(merchantUrl).digest("hex");

    // If anything for this hash is already cached (regardless of extension),
    // reuse it without refetching.
    try {
      const { data: existing } = await supabase.storage.from(BUCKET).list(CACHE_PREFIX, {
        limit: 5,
        search: hash,
      });
      const hit = (existing ?? []).find((f) => f.name.startsWith(`${hash}.`));
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
