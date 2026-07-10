// find-affiliate-seller v1 — "find it elsewhere" for the affiliate-match suggester.
// For a closet item whose brand isn't in our feeds (no suggest_affiliate_matches hit),
// web-search the product, then check each retailer result against our joined merchants
// via affiliate-wrap-url. Any result that wraps (provider != 'none') is a monetizable
// seller the creator could earn through. Extends coverage past the in-feed ~24%.
//
// Search uses Bright Data Web Unlocker (same key/zone as scrape-product) on a Google
// results page; wrap-check reuses affiliate-wrap-url so merchant-matching + attribution
// stay in one place.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRIGHTDATA_API_KEY = Deno.env.get("BRIGHTDATA_API_KEY") ?? "";
const BRIGHTDATA_UNLOCKER_ZONE = Deno.env.get("BRIGHTDATA_UNLOCKER_ZONE") ?? "cli_unlocker";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

// Hosts that are never a shoppable retailer result.
const SKIP_HOST_RE = /(^|\.)(google\.|gstatic\.|googleusercontent\.|youtube\.|youtu\.be|facebook\.|instagram\.|pinterest\.|tiktok\.|twitter\.|x\.com|reddit\.|wikipedia\.|schema\.org|w3\.org|bing\.|microsoft\.|apple\.|linkedin\.|tumblr\.|quora\.|yelp\.)/i;

function extractCandidateUrls(html: string, max: number): string[] {
  const out: string[] = [];
  const seenHost = new Set<string>();
  const push = (raw: string) => {
    let dec = raw;
    try { dec = decodeURIComponent(raw); } catch { /* keep */ }
    if (!/^https?:\/\//i.test(dec)) return;
    let host = "";
    try { host = new URL(dec).hostname.toLowerCase().replace(/^www\./, ""); } catch { return; }
    if (!host || SKIP_HOST_RE.test(host)) return;
    if (seenHost.has(host)) return;
    seenHost.add(host);
    out.push(dec);
  };
  // Google redirect form: /url?q=<url>&...
  const reQ = /\/url\?q=(https?[^&"]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = reQ.exec(html)) !== null && out.length < max) push(m[1]);
  // Direct hrefs
  const reH = /href="(https?:\/\/[^"]+)"/gi;
  while ((m = reH.exec(html)) !== null && out.length < max) push(m[1]);
  return out.slice(0, max);
}

async function brightDataSerp(query: string): Promise<{ status: number; html: string }> {
  const target = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=20&gl=us&hl=en`;
  const res = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: { "Authorization": `Bearer ${BRIGHTDATA_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ zone: BRIGHTDATA_UNLOCKER_ZONE, url: target, format: "raw" }),
    signal: AbortSignal.timeout(45000),
  });
  const html = await res.text();
  return { status: res.status, html };
}

async function wrapCheck(url: string, creatorId: string | null): Promise<{ url: string; provider: string; merchant: any } | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/affiliate-wrap-url`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${SERVICE_ROLE}`, "apikey": SERVICE_ROLE, "Content-Type": "application/json" },
      body: JSON.stringify(creatorId ? { url, creator_id: creatorId } : { url }),
    });
    const j = await r.json();
    if (j?.ok && j?.provider && j.provider !== "none" && j?.wrapped_url) {
      return { url, provider: j.provider, merchant: j.merchant ?? null };
    }
  } catch { /* ignore */ }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ ok: false, error: "method_not_allowed" }, 405);
  if (!BRIGHTDATA_API_KEY) return jsonRes({ ok: false, error: "brightdata_key_missing" }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* */ }
  const brand = String(body.brand ?? "").trim();
  const name = String(body.name ?? "").trim();
  const creatorId = body.creator_id ? String(body.creator_id).trim() : null;
  const limit = Math.min(Math.max(Number(body.limit ?? 5), 1), 10);
  const debug = body.debug === true;
  if (!brand && !name) return jsonRes({ ok: false, error: "brand_or_name_required" }, 400);

  const query = [brand, name].filter(Boolean).join(" ").slice(0, 160);

  let serp: { status: number; html: string };
  try {
    serp = await brightDataSerp(query);
  } catch (e) {
    return jsonRes({ ok: false, error: `serp_failed: ${(e as Error).message}` }, 502);
  }
  if (serp.status < 200 || serp.status >= 300) {
    return jsonRes({ ok: false, error: `serp_status_${serp.status}`, query }, 502);
  }

  const candidates = extractCandidateUrls(serp.html, 14);
  const checked = await Promise.all(candidates.map((u) => wrapCheck(u, creatorId)));

  // Dedupe monetizable sellers by merchant id (or provider+host).
  const sellers: Array<{ url: string; provider: string; merchant_name: string | null; merchant_id: string | null }> = [];
  const seen = new Set<string>();
  for (const c of checked) {
    if (!c) continue;
    const mid = c.merchant?.id ?? `${c.provider}:${(() => { try { return new URL(c.url).hostname; } catch { return c.url; } })()}`;
    if (seen.has(mid)) continue;
    seen.add(mid);
    sellers.push({ url: c.url, provider: c.provider, merchant_name: c.merchant?.name ?? null, merchant_id: c.merchant?.id ?? null });
    if (sellers.length >= limit) break;
  }

  const resp: Record<string, unknown> = { ok: true, query, candidates_found: candidates.length, sellers };
  if (debug) resp.debug = { serp_status: serp.status, html_len: serp.html.length, sample_candidates: candidates.slice(0, 14) };
  return jsonRes(resp);
});
