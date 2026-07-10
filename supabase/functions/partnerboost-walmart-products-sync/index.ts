// partnerboost-walmart-products-sync v3 — Walmart WOMEN'S CLOTHING (broad)
// from PartnerBoost global datafeed (mod=datafeed&op=list, brand_type=Walmart,
// many women's-apparel keywords) into partnerboost_products under synthetic
// 'Walmart' merchant. v3: store merchant_category=NULL (the broad Walmart
// 'Clothing, Shoes & Accessories' poisoned infer_department → all tagged Shoes);
// classification now by product NAME. Broader default keyword set; excludes
// children's. Run with subsets of `keywords` in parallel to cover more without
// EF timeout. tracking_url empty → click-time wrap (follow-up).
// POST body: { keywords?: string[], max_pages_per_keyword?: int, dry_run?: bool }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PB_TOKEN = Deno.env.get("PARTNERBOOST_API_TOKEN") ?? "";
const PB_LIST = "https://app.partnerboost.com/api.php?mod=datafeed&op=list";
const WALMART_PB_BRAND_ID = "walmart-marketplace";

const DEFAULT_KEYWORDS = [
  "women dress", "women maxi dress", "women midi dress", "women cocktail dress",
  "women blouse", "women t shirt", "women tank top", "women tunic", "women bodysuit",
  "women sweater", "women cardigan", "women hoodie", "women jacket", "women blazer",
  "women coat", "women jeans", "women pants", "women trousers", "women skirt",
  "women leggings", "women shorts", "women jumpsuit", "women romper", "women activewear",
  "women swimsuit", "women lingerie", "women shoes", "women boots", "women heels",
  "women sandals", "women handbag", "women purse",
];
const APPAREL_RE = /cloth|shoe|accessor|apparel|jewelr|bag|handbag|purse|dress|wear|footwear|lingerie|intimate/i;
// Exclude children's / men's that slip through women's keyword searches.
const NOT_WOMEN_RE = /\b(men's|mens|boys?|girls?|kids?|child|children|toddler|baby|infant|junior)\b/i;

function jsonRes(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
}
function money(s: unknown): number | null {
  const n = parseFloat(String(s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
async function pbList(kw: string, page: number) {
  const r = await fetch(PB_LIST, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: PB_TOKEN, brand_type: "Walmart", keywords: kw, page, limit: 100 }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* */ }
  return { status: r.status, json: j, text };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  if (!PB_TOKEN) return jsonRes({ error: "no_PARTNERBOOST_API_TOKEN" }, 500);
  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const keywords: string[] = Array.isArray(body.keywords) && body.keywords.length ? body.keywords : DEFAULT_KEYWORDS;
  const maxPages = Math.min(Math.max(body.max_pages_per_keyword ?? 5, 1), 30);
  const dryRun = body.dry_run === true;

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: m } = await supa.from("partnerboost_merchants").select("id").eq("pb_brand_id", WALMART_PB_BRAND_ID).maybeSingle();
  if (!m?.id) return jsonRes({ error: "walmart_merchant_missing" }, 404);
  const merchantId = m.id;
  const nowIso = new Date().toISOString();
  const seenSkus = new Set<string>();
  const perKw: any[] = [];
  let totalKept = 0;

  for (const kw of keywords) {
    let page = 1, kept = 0, seen = 0, hasMore = true, err: string | null = null;
    while (page <= maxPages && hasMore) {
      const { status, json, text } = await pbList(kw, page);
      if (status !== 200 || json?.status?.code !== 0) { err = `p${page}: ${status} ${(text || "").slice(0, 100)}`; break; }
      const list: any[] = json?.data?.list ?? [];
      hasMore = json?.data?.has_more === true;
      if (!list.length) break;
      seen += list.length;
      const rows: any[] = [];
      for (const p of list) {
        const sku = p.sku ? String(p.sku) : "";
        if (!sku || !p.image) continue;
        if (!APPAREL_RE.test(p.category || "")) continue;
        if (NOT_WOMEN_RE.test(p.name || "")) continue;
        if (seenSkus.has(sku)) continue;
        seenSkus.add(sku);
        rows.push({
          merchant_id: merchantId,
          product_id_in_feed: sku,
          sku,
          name: (p.name ?? "").slice(0, 500),
          brand: p.brand ?? null,
          category: null,
          merchant_category: null,
          price: money(p.price),
          search_price: money(p.price),
          rrp_price: money(p.old_price),
          currency: p.currency ?? "USD",
          in_stock: /in.?stock/i.test(String(p.availability ?? "")),
          product_url: p.url ?? null,
          deep_link: p.tracking_url || null,
          image_urls: p.image ? [p.image] : [],
          source: "pb_walmart_datafeed",
          last_seen_at: nowIso,
          removed_at: null,
          updated_at: nowIso,
        });
      }
      if (!dryRun && rows.length) {
        const { error } = await supa.from("partnerboost_products").upsert(rows, { onConflict: "merchant_id,product_id_in_feed" });
        if (error) { err = `upsert p${page}: ${error.message.slice(0, 100)}`; break; }
      }
      kept += rows.length;
      page++;
      await new Promise((r) => setTimeout(r, 100));
    }
    totalKept += kept;
    perKw.push({ keyword: kw, pages: page - 1, seen, kept });
  }

  if (!dryRun) {
    await supa.from("partnerboost_merchants")
      .update({ feed_last_product_count: seenSkus.size, feed_last_synced_at: nowIso, updated_at: nowIso })
      .eq("id", merchantId);
  }
  return jsonRes({ ok: true, dry_run: dryRun, distinct_skus: seenSkus.size, total_kept: totalKept, keywords: keywords.length });
});
