// partnerboost-datafeed-sync v3 (2026-07-07) — DTC + Walmart product feeds via
// PartnerBoost mod=datafeed&op=list. DTC → each brand's own merchant_id
// (source='partnerboost-dtc'). WALMART → routed to the single 'Walmart' umbrella
// merchant (Amazon-style one-card model), source='partnerboost-walmart'.
// Skips synthetic non-numeric pb_brand_id (the umbrella itself).
// Dedup by product_url; women's/apparel ranked first; cap per brand.
//
// POST body: { brand_ids?, brand_types?, max_pages?(3), cap_per_brand?(150),
//   apparel_first?, refresh_matview?, dry_run? }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PB_TOKEN = Deno.env.get("PARTNERBOOST_API_TOKEN") ?? "";
const FEED_URL = "https://app.partnerboost.com/api.php?mod=datafeed&op=list";
const WALMART_UMBRELLA_ID = "478f7819-a83a-443f-8f9e-2370cfcc65a1"; // synthetic 'Walmart' card

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonRes(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
}
function money(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") { const n = parseFloat(v.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
}
const CLOTHING_RE = /apparel|clothing|dress|blouse|\btop(s)?\b|shirt|skirt|sweater|knit|jeans|denim|pant|trouser|short|jumpsuit|romper|swim|bikini|lingerie|legging|outerwear|coat|jacket|cardigan|hoodie|loungewear|shapewear|bodysuit/i;
const WOMEN_RE = /women|woman|ladies|\bdress\b|blouse|skirt|shapewear|bodysuit|lingerie/i;
const MEN_ONLY_RE = /\bmen'?s\b|\bfor men\b|\bmale\b/i;
function apparelScore(name: string, cat: string): number {
  const s = `${name} ${cat}`;
  let score = 0;
  if (CLOTHING_RE.test(s)) score += 3;
  if (WOMEN_RE.test(s)) score += 2;
  if (MEN_ONLY_RE.test(s) && !WOMEN_RE.test(s)) score -= 3;
  return score;
}
async function fetchFeed(brandId: string, page: number, limit: number) {
  const r = await fetch(FEED_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: PB_TOKEN, brand_id: brandId, page, limit }),
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
  if (!PB_TOKEN) return jsonRes({ error: "no_PARTNERBOOST_API_TOKEN" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const explicitIds: string[] | null = Array.isArray(body.brand_ids) && body.brand_ids.length
    ? body.brand_ids.map((b: unknown) => String(b)) : null;
  const brandTypes: string[] = Array.isArray(body.brand_types) && body.brand_types.length
    ? body.brand_types.map((b: unknown) => String(b)) : ["DTC", "Walmart"];
  const maxPages = Math.min(Math.max(body.max_pages ?? 3, 1), 50);
  const capPerBrand = Math.min(Math.max(body.cap_per_brand ?? 150, 1), 5000);
  const apparelFirst = body.apparel_first !== false;
  const doRefresh = body.refresh_matview === true;
  const dryRun = body.dry_run === true;

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  let mq = supa.from("partnerboost_merchants")
    .select("id, pb_brand_id, merchant_name, brand_type")
    .eq("status", "active");
  if (explicitIds) mq = mq.in("pb_brand_id", explicitIds);
  else mq = mq.in("brand_type", brandTypes);
  const { data: brands, error: bErr } = await mq;
  if (bErr) return jsonRes({ error: `brand_lookup: ${bErr.message}` }, 500);
  if (!brands?.length) return jsonRes({ ok: true, note: "no matching brands", per_brand: [] });

  const perBrand: any[] = [];
  let totalUpserted = 0;
  let sampleKeys: string[] | null = null;

  for (const b of brands) {
    const brandId = String(b.pb_brand_id);
    if (!/^\d+$/.test(brandId)) { perBrand.push({ brand: b.merchant_name, brand_id: brandId, skipped: "non-numeric brand_id" }); continue; }
    const isWalmart = b.brand_type === "Walmart";
    const targetMerchantId = isWalmart ? WALMART_UMBRELLA_ID : b.id;
    const src = isWalmart ? "partnerboost-walmart" : "partnerboost-dtc";
    const byUrl = new Map<string, any>();
    let page = 1, seen = 0, hasMore = true, err: string | null = null, total: string | null = null;

    while (page <= maxPages && hasMore) {
      const { status, json, text } = await fetchFeed(brandId, page, 100);
      const code = json?.status?.code ?? json?.code;
      if (status !== 200 || code !== 0) { err = `p${page}: ${status}/${code} ${(text || "").slice(0, 120)}`; break; }
      const list: any[] = json?.data?.list ?? [];
      total = json?.data?.total ?? total;
      if (!sampleKeys && list[0]) sampleKeys = Object.keys(list[0]);
      if (list.length === 0) break;
      seen += list.length;
      for (const p of list) {
        const url = typeof p.url === "string" ? p.url : null;
        if (!url) continue;
        if (!byUrl.has(url)) byUrl.set(url, p);
      }
      hasMore = list.length >= 100;
      page++;
      await new Promise((r) => setTimeout(r, 120));
    }

    let deduped = [...byUrl.values()];
    if (apparelFirst) {
      deduped = deduped
        .map((p) => ({ p, s: apparelScore(String(p.name ?? ""), String(p.category ?? "")) }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.p);
    }
    const chosen = deduped.slice(0, capPerBrand);

    const rows = chosen.map((p) => {
      const price = money(p.price);
      return {
        merchant_id: targetMerchantId,
        product_id_in_feed: String(p.url).slice(0, 500),
        sku: p.sku ?? null,
        name: String(p.name ?? "").slice(0, 500),
        description: (typeof p.description === "string" && p.description.toLowerCase() !== "n/a") ? p.description : null,
        brand: p.brand ?? b.merchant_name ?? null,
        category: p.category ?? null,
        merchant_category: null,
        price,
        search_price: price,
        rrp_price: money(p.old_price),
        currency: p.currency ?? "USD",
        in_stock: p.availability ? /in.?stock|available/i.test(String(p.availability)) : true,
        product_url: String(p.url),
        deep_link: p.tracking_url ?? p.tracking_url_short ?? null,
        image_urls: p.image ? [p.image] : [],
        lifestyle_image_url: null,
        source: src,
        last_seen_at: new Date().toISOString(),
        removed_at: null,
        updated_at: new Date().toISOString(),
      };
    });

    if (!dryRun && rows.length) {
      const { error } = await supa.from("partnerboost_products").upsert(rows, { onConflict: "merchant_id,product_id_in_feed" });
      if (error) { err = `upsert: ${error.message.slice(0, 150)}`; }
      else totalUpserted += rows.length;
    }
    perBrand.push({ brand: b.merchant_name, brand_id: brandId, brand_type: b.brand_type, routed_to: isWalmart ? "walmart-umbrella" : "self", feed_total: total, seen, deduped: byUrl.size, upserted: dryRun ? 0 : rows.length, error: err });
  }

  let matviewRefreshed = false, refreshErr: string | null = null;
  if (doRefresh && !dryRun && totalUpserted > 0) {
    try {
      const { error } = await supa.rpc("refresh_affiliate_products", { concurrent: true });
      if (error) refreshErr = error.message.slice(0, 150); else matviewRefreshed = true;
    } catch (e) { refreshErr = (e as Error).message.slice(0, 150); }
  }

  return jsonRes({ ok: true, source: "partnerboost-dtc/walmart", brands: brands.length, total_upserted: totalUpserted, feed_field_keys: sampleKeys, per_brand: perBrand, matview_refreshed: matviewRefreshed, refresh_error: refreshErr });
});
