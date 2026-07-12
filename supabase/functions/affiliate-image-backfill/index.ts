// affiliate-image-backfill — fills image_urls for in-stock products that were
// ingested WITHOUT images. Some CJ advertisers (Avidlove, Especially Yours,
// Mytheresa, ...) come through CJ's feed with imageLink=null even though the
// products have images on the merchant's own site. Since the catalog matview
// requires an image, those products are invisible. This job re-fetches the
// images from each product URL via the product-info function (Shopify-first
// .json + general scrape) and writes them back to image_urls.
//
//   POST { limit?, domain?, dry_run? }
//     limit   — max products this run (default 100, max 500)
//     domain  — only backfill products whose URL host contains this (e.g. "avidlove.com")
//     dry_run — fetch + report but don't write
//   → { data: { candidates, processed, updated, still_empty, sample } }
//
// Idempotent + additive: only writes image_urls where we found images; never
// removes data. Pairs with cj-feeds-sync v5, which preserves these on re-sync.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const CONCURRENCY = 4;
const MAX_IMAGES = 6;

async function fetchImages(url: string): Promise<string[]> {
  try {
    const endpoint = `${SUPABASE_URL}/functions/v1/product-info?cache=0&url=${encodeURIComponent(url)}`;
    const res = await fetch(endpoint, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return [];
    const body = await res.json().catch(() => null);
    const d = body?.data;
    if (!d) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const u of [d.imageUrl, ...(Array.isArray(d.imageUrls) ? d.imageUrls : [])]) {
      if (typeof u === "string" && u && !seen.has(u)) { seen.add(u); out.push(u); }
    }
    return out.slice(0, MAX_IMAGES);
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ error: { message: "Method not allowed", code: "METHOD_NOT_ALLOWED" } }, 405);

  let body: { limit?: number; domain?: string; dry_run?: boolean } = {};
  try { body = await req.json(); } catch { /* */ }
  const limit = Math.min(Math.max(body.limit ?? 100, 1), 500);
  const domain = (body.domain ?? "").trim();
  const dryRun = body.dry_run === true;

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Candidates: in-stock, image-less, with a product URL.
  let q = supa.from("cj_products")
    .select("merchant_id, product_id_in_feed, product_url, image_urls")
    .eq("in_stock", true)
    .not("product_url", "is", null)
    .or("image_urls.is.null,image_urls.eq.{}")
    .limit(limit);
  if (domain) q = q.ilike("product_url", `%${domain}%`);
  const { data: rows, error } = await q;
  if (error) return jsonRes({ error: { message: error.message, code: "QUERY_FAILED" } }, 500);

  const candidates = rows ?? [];
  let processed = 0;
  let updated = 0;
  let stillEmpty = 0;
  const sample: Array<{ url: string; images: number }> = [];

  // Bounded-concurrency worker pool.
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const row = candidates[cursor++] as {
        merchant_id: string; product_id_in_feed: string; product_url: string;
      };
      processed++;
      const imgs = await fetchImages(row.product_url);
      if (sample.length < 5) sample.push({ url: row.product_url.slice(0, 60), images: imgs.length });
      if (imgs.length === 0) { stillEmpty++; continue; }
      if (dryRun) { updated++; continue; }
      const { error: upErr } = await supa.from("cj_products")
        .update({ image_urls: imgs, updated_at: new Date().toISOString() })
        .eq("merchant_id", row.merchant_id)
        .eq("product_id_in_feed", row.product_id_in_feed);
      if (!upErr) updated++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, () => worker()));

  return jsonRes({ data: { candidates: candidates.length, processed, updated, still_empty: stillEmpty, dry_run: dryRun, sample } });
});
