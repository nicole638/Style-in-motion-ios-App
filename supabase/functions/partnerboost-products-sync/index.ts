// partnerboost-products-sync (v12) — SEPARATED FROM CJ. Pulls the PartnerBoost
// Amazon-Marketplace catalog via PartnerBoost's CJ-PID Product API and writes
// into **partnerboost_products** (merchant pb_brand_id='amazon-marketplace').
//
// v11 (2026-07-06): capture category/description/lifestyle on ingest (null-safe).
//   Confirmed via feed_field_keys: the feed has NO description (Amazon feeds are
//   sparse) — so description stays null; category WAS being dropped (fixed).
// v12 (2026-07-06): also capture parent_asin (variant grouping), rating,
//   review_count, is_amazon_choice, is_featured — real feed fields we were
//   discarding. Defensive parsers (feed values may be number|string|"1"/"0").
//   Goal: capture everything useful on ingest so search/ranking never needs a
//   1.5M-row re-backfill later.
//
// MODES (precedence: brand_ids > subcategories/has_acc). Auth: CJ publisher PID.
// Endpoint requires header Request-Source: cj and body pid (+brand_id) as INTs.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PB_API = "https://cj.partnerboost.com/api/get_products";
const PB_MERCHANT_PBID = "amazon-marketplace";

const DEFAULT_SUBCATS = [
  "Dresses", "Tops, Tees & Blouses", "Active", "Sweaters", "Jeans", "Pants", "Shorts",
  "Skirts", "Coats, Jackets & Vests", "Jumpsuits, Rompers & Overalls", "Swimsuits & Cover Ups",
  "Lingerie, Sleep & Lounge", "Leggings", "Shoes", "Handbags & Wallets",
];
const DOLL_RE = /for dolls|doll clothes|inch doll|american girl|fits 1[0-9]/i;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonRes(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}
function parseMoney(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}
// v11/v12 defensive extractors — feeds are inconsistent about types/keys.
function pick(p: any, ...keys: string[]): string | null {
  for (const k of keys) { const v = p?.[k]; if (typeof v === "string" && v.trim() !== "") return v; }
  return null;
}
function pnum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") { const n = parseFloat(v.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
}
function pint(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : null;
  if (typeof v === "string") { const n = parseInt(v.replace(/[^0-9]/g, ""), 10); return Number.isFinite(n) ? n : null; }
  return null;
}
function pbool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v == null) return null;
  const s = String(v).toLowerCase();
  if (s === "1" || s === "true" || s === "yes") return true;
  if (s === "0" || s === "false" || s === "no" || s === "") return false;
  return null;
}
async function pbGetProducts(pid: number, subcat: string | null, page: number, pageSize: number, country: string, hasAcc: boolean, brandId?: string | null) {
  const reqBody: Record<string, unknown> = { pid, page_num: page, page_size: pageSize, country_code: country };
  if (subcat != null) reqBody.subcategory = subcat;
  if (hasAcc) reqBody.has_acc = 1;
  if (brandId != null) reqBody.brand_id = /^\d+$/.test(brandId) ? parseInt(brandId, 10) : brandId;
  const r = await fetch(PB_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Request-Source": "cj" },
    body: JSON.stringify(reqBody),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* */ }
  return { status: r.status, json: j, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const hasAcc = body.has_acc === 1 || body.has_acc === true;
  const brandIds: string[] | null = Array.isArray(body.brand_ids) && body.brand_ids.length
    ? body.brand_ids.map((b: unknown) => String(b)) : null;
  const explicitSubs = Array.isArray(body.subcategories) && body.subcategories.length;
  const subcats: (string | null)[] = explicitSubs ? body.subcategories : (hasAcc ? [null] : DEFAULT_SUBCATS);
  const buckets: (string | null)[] = brandIds ?? subcats;
  const maxPages = Math.min(Math.max(body.max_pages_per_subcat ?? 8, 1), 200);
  const pageSize = Math.min(Math.max(body.page_size ?? 50, 1), 50);
  const country = body.country_code ?? "US";
  const doRefresh = body.refresh_matview !== false;
  const refreshConcurrent = body.refresh_concurrent !== false;
  const dryRun = body.dry_run === true;

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: cfg } = await supa.from("cj_publisher_config").select("website_id").eq("is_default", true).maybeSingle();
  const pid = cfg?.website_id ? parseInt(String(cfg.website_id), 10) : NaN;
  if (!Number.isFinite(pid)) return jsonRes({ error: "no_pid" }, 500);
  const { data: merchant } = await supa.from("partnerboost_merchants").select("id").eq("pb_brand_id", PB_MERCHANT_PBID).maybeSingle();
  if (!merchant?.id) return jsonRes({ error: "pb_merchant_not_found" }, 404);
  const merchantId = merchant.id;

  const perSub: any[] = [];
  let totalUpserted = 0, totalSkippedDolls = 0;
  let sampleKeys: string[] | null = null;
  for (const bucket of buckets) {
    const brandMode = brandIds != null;
    const sub = brandMode ? null : bucket;
    const brandId = brandMode ? bucket : null;
    let page = 1, upserted = 0, seen = 0, hasMore = true, err: string | null = null;
    while (page <= maxPages && hasMore) {
      const { status, json, text } = await pbGetProducts(pid, sub, page, pageSize, country, hasAcc, brandId);
      if (status !== 200 || !json || json.code !== 0) { err = `page${page}: ${status} ${(text || "").slice(0, 150)}`; break; }
      const list: any[] = json.data?.list ?? [];
      hasMore = json.data?.has_more === true;
      if (list.length === 0) break;
      if (!sampleKeys && list[0]) sampleKeys = Object.keys(list[0]);
      seen += list.length;
      const rows = list
        .filter((p) => p.product_id && !DOLL_RE.test(p.product_name || ""))
        .map((p) => ({
          merchant_id: merchantId,
          product_id_in_feed: p.product_id,
          sku: p.asin ?? null,
          name: (p.product_name ?? "").slice(0, 500),
          brand: p.brand_name ?? null,
          category: pick(p, "category", "product_category", "google_category"),
          merchant_category: p.subcategory ?? null,
          description: pick(p, "description", "product_description", "desc", "long_description", "short_description"),
          price: parseMoney(p.discount_price),
          search_price: parseMoney(p.discount_price),
          rrp_price: parseMoney(p.original_price),
          currency: "USD",
          in_stock: String(p.availability ?? "").toUpperCase() === "IN_STOCK",
          product_url: p.url ?? null,
          deep_link: p.url ?? null,
          image_urls: p.image ? [p.image] : [],
          lifestyle_image_url: pick(p, "lifestyle_image", "lifestyle_image_url", "image_lifestyle"),
          parent_asin: p.parent_asin ?? null,
          rating: pnum(p.rating),
          review_count: pint(p.reviews),
          is_amazon_choice: pbool(p.is_amazon_choice),
          is_featured: pbool(p.is_featured_product),
          source: "amazon-marketplace",
          last_seen_at: new Date().toISOString(),
          removed_at: null,
          updated_at: new Date().toISOString(),
        }));
      totalSkippedDolls += (list.length - rows.length);
      if (!dryRun && rows.length) {
        const { error } = await supa.from("partnerboost_products").upsert(rows, { onConflict: "merchant_id,product_id_in_feed" });
        if (error) { err = `upsert page${page}: ${error.message.slice(0, 150)}`; break; }
        upserted += rows.length;
      }
      page++;
      await new Promise((r) => setTimeout(r, 120));
    }
    totalUpserted += upserted;
    perSub.push({ bucket: brandMode ? `brand:${brandId}` : (sub ?? "(all_acc)"), pages: page - 1, seen, upserted, error: err });
  }

  let matviewRefreshed = false, refreshErr: string | null = null;
  if (doRefresh && !dryRun && totalUpserted > 0) {
    try {
      const { error } = await supa.rpc("refresh_affiliate_products", { concurrent: refreshConcurrent });
      if (error) refreshErr = error.message.slice(0, 150); else matviewRefreshed = true;
    } catch (e) { refreshErr = (e as Error).message.slice(0, 150); }
  }
  return jsonRes({ ok: true, target: "partnerboost_products", has_acc: hasAcc, brand_mode: brandIds != null, pid, merchant_id: merchantId, total_upserted: totalUpserted, skipped_dolls: totalSkippedDolls, feed_field_keys: sampleKeys, per_bucket: perSub, matview_refreshed: matviewRefreshed, refresh_error: refreshErr });
});
