// social-followers — Supabase Edge Function port of the Hono backend's
// /api/social-followers route (Vibecode migration, 2026-07-09). Logic
// verbatim; framework surface converted (Hono → Deno.serve) and the Node
// .env-file fallback replaced by Deno.env (function secrets). Zod validation
// replaced with an exact-message hand check (same error strings, same
// envelope) to keep the function dependency-free.
//
// verify_jwt=false — matches the legacy backend's exposure (public GET, input
// is a public @handle, output is a public follower count). Fail-soft: missing
// ScrapingBee key or parse miss → 502 FETCH_ERROR, exactly like legacy.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SCRAPINGBEE_API_KEY = Deno.env.get("SCRAPINGBEE_API_KEY") ?? "";

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

/** Parse "277", "12.5K", "1.2M" → integer */
function parseCount(raw: string): number {
  const clean = raw.replace(/,/g, "").trim();
  const lower = clean.toLowerCase();
  if (lower.endsWith("k")) return Math.round(parseFloat(clean) * 1_000);
  if (lower.endsWith("m")) return Math.round(parseFloat(clean) * 1_000_000);
  if (lower.endsWith("b")) return Math.round(parseFloat(clean) * 1_000_000_000);
  return parseInt(clean, 10) || 0;
}

/**
 * Scrape a URL via ScrapingBee and return the raw HTML body.
 * Uses render_js=true so Instagram/TikTok actually populate the page.
 */
async function scrapeHtml(targetUrl: string): Promise<string | null> {
  if (!SCRAPINGBEE_API_KEY) {
    console.warn("[social-followers] SCRAPINGBEE_API_KEY not set");
    return null;
  }

  const params = new URLSearchParams({
    api_key: SCRAPINGBEE_API_KEY,
    url: targetUrl,
    render_js: "true",
    wait: "3000",
    premium_proxy: "true",
    block_resources: "false",
  });

  console.log(`[social-followers] ScrapingBee request for ${targetUrl}`);
  const res = await fetch(`https://app.scrapingbee.com/api/v1/?${params}`);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(
      `[social-followers] ScrapingBee ${res.status} for ${targetUrl}: ${body.slice(0, 200)}`,
    );
    return null;
  }

  return res.text();
}

/** Extract follower count from Instagram HTML using multiple strategies */
function parseInstagramHtml(html: string): number | null {
  // Strategy 1: OG description — "277 Followers, 123 Following, 45 Posts"
  const ogMatch = html.match(
    /<meta\s+property="og:description"\s+content="([^"]+)"/i,
  );
  if (ogMatch) {
    const descMatch = ogMatch[1]!.match(/([\d.,]+[KMBkmb]?)\s+Followers/i);
    if (descMatch) return parseCount(descMatch[1]!);
  }

  // Strategy 2: JSON "edge_followed_by":{"count":277}
  const edgeMatch = html.match(/"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/);
  if (edgeMatch) return parseInt(edgeMatch[1]!, 10);

  // Strategy 3: JSON "follower_count":277
  const countMatch = html.match(/"follower_count"\s*:\s*(\d+)/);
  if (countMatch) return parseInt(countMatch[1]!, 10);

  return null;
}

/** Extract follower count from TikTok HTML using multiple strategies */
function parseTikTokHtml(html: string): number | null {
  // Strategy 1: OG description — "12.5K Followers, 456 Following"
  const ogMatch = html.match(
    /<meta\s+property="og:description"\s+content="([^"]+)"/i,
  );
  if (ogMatch) {
    const descMatch = ogMatch[1]!.match(/([\d.,]+[KMBkmb]?)\s+Followers/i);
    if (descMatch) return parseCount(descMatch[1]!);
  }

  // Strategy 2: JSON "followerCount":277
  const countMatch = html.match(/"followerCount"\s*:\s*(\d+)/);
  if (countMatch) return parseInt(countMatch[1]!, 10);

  return null;
}

async function fetchInstagramFollowers(handle: string): Promise<number | null> {
  try {
    const html = await scrapeHtml(`https://www.instagram.com/${handle}/`);
    if (!html) return null;
    const count = parseInstagramHtml(html);
    if (count != null) console.log(`[social-followers] IG parsed: ${count}`);
    return count;
  } catch (e) {
    console.warn("[social-followers] Instagram error:", e);
    return null;
  }
}

async function fetchTikTokFollowers(handle: string): Promise<number | null> {
  try {
    const html = await scrapeHtml(`https://www.tiktok.com/@${handle}`);
    if (!html) return null;
    const count = parseTikTokHtml(html);
    if (count != null) console.log(`[social-followers] TikTok parsed: ${count}`);
    return count;
  } catch (e) {
    console.warn("[social-followers] TikTok error:", e);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json({ error: { message: "Not found", code: "NOT_FOUND" } }, 404);
  }

  const sp = new URL(req.url).searchParams;
  const handle = sp.get("handle");
  const platform = sp.get("platform");

  // Same validation semantics (and messages) as the legacy zod schema.
  const issues: string[] = [];
  if (!handle || handle.length < 1) issues.push("handle is required");
  if (platform !== "instagram" && platform !== "tiktok")
    issues.push("platform must be 'instagram' or 'tiktok'");
  if (issues.length > 0) {
    return json({ error: { message: issues.join("; "), code: "VALIDATION_ERROR" } }, 400);
  }

  const p = platform as "instagram" | "tiktok";
  const cleanHandle = handle!.replace(/^@/, "");
  console.log(`[social-followers] Fetching @${cleanHandle} on ${p}`);

  const count =
    p === "instagram"
      ? await fetchInstagramFollowers(cleanHandle)
      : await fetchTikTokFollowers(cleanHandle);

  if (count == null) {
    console.warn(`[social-followers] Could not fetch count for @${cleanHandle} on ${p}`);
    return json(
      { error: { message: "Could not fetch follower count", code: "FETCH_ERROR" } },
      502,
    );
  }

  console.log(`[social-followers] @${cleanHandle} on ${p} → ${count} followers`);
  return json({ data: { count, platform: p } });
});
