import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PB_API = "https://cj.partnerboost.com/api/get_products";
const EXPIRE_AFTER_DAYS = 2;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonRes(b, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }

function parseCommission(raw) {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (t.endsWith("%")) { const n = parseFloat(t.replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
}

async function pbFetch(pid, category, page, pageSize) {
  const r = await fetch(PB_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Request-Source": "cj" },
    body: JSON.stringify({ pid, page_num: page, page_size: pageSize, country_code: "US", has_acc: 1, category }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch (_e) { /* */ }
  return { status: r.status, json: j, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  let body = {};
  try { body = await req.json(); } catch (_e) { /* */ }
  const pagesPerRun = Math.min(Math.max(body.pages_per_run ?? 40, 1), 200);
  const pageSize = Math.min(Math.max(body.page_size ?? 50, 1), 50);
  const softDeadlineMs = 110000;
  const started = Date.now();

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: cfg } = await supa.from("cj_publisher_config").select("website_id").eq("is_default", true).maybeSingle();
  const pid = cfg?.website_id ? parseInt(String(cfg.website_id), 10) : NaN;
  if (!Number.isFinite(pid)) return jsonRes({ error: "no_pid" }, 500);

  const { data: incl } = await supa.from("campaign_category_includes").select("category");
  const categories = (incl ?? []).map((r) => r.category).filter(Boolean);
  if (categories.length === 0) return jsonRes({ error: "no_include_categories" }, 400);

  const { data: curRows } = await supa.from("discovery_cursor").select("*");
  const cur = {};
  for (const c of curRows ?? []) cur[c.category] = c;

  const { data: camps } = await supa.from("campaigns").select("asins").is("archived_at", null);
  const inCampaign = new Set();
  for (const c of camps ?? []) for (const a of (c.asins ?? [])) inCampaign.add(String(a).toUpperCase());

  let budget = pagesPerRun;
  let totalSeen = 0, totalUps = 0, totalSkip = 0, err = null;
  const nowIso = new Date().toISOString();
  const perCat = {};

  for (const category of categories) {
    const st = cur[category] ?? { next_page: 1, exhausted: false };
    if (st.exhausted) { perCat[category] = { skipped: "exhausted" }; continue; }
    let page = st.next_page ?? 1;
    let seen = 0, ups = 0, done = false;

    while (budget > 0 && (Date.now() - started) < softDeadlineMs) {
      const { status, json, text } = await pbFetch(pid, category, page, pageSize);
      if (status !== 200 || !json || json.code !== 0) { err = `${category} p${page}: ${status} ${(text || "").slice(0, 120)}`; break; }
      const list = json.data?.list ?? [];
      const hasMore = json.data?.has_more === true;
      if (list.length === 0) { done = true; break; }
      seen += list.length;
      const rows = [];
      for (const p of list) {
        const asin = (p.asin || "").toUpperCase();
        if (!asin) continue;
        if (inCampaign.has(asin)) { totalSkip++; continue; }
        rows.push({
          asin,
          parent_asin: p.parent_asin ? String(p.parent_asin).toUpperCase() : null,
          variant_asins: p.variant_asin ?? null,
          product_name: (p.product_name ?? "").slice(0, 500),
          brand_name: p.brand_name ?? null,
          brand_id: p.brand_id != null ? String(p.brand_id) : null,
          commission_rate_pct: parseCommission(p.commission),
          commission_raw: p.commission ?? null,
          image_url: p.image ?? null,
          product_url: p.url ?? null,
          category: p.category ?? null,
          subcategory: p.subcategory ?? null,
          last_seen_at: nowIso,
        });
      }
      if (rows.length) {
        // Dedupe by asin within this page before upserting: Postgres ON CONFLICT
        // cannot update the same target row twice in one statement, and PartnerBoost
        // returns the same asin more than once on a page (product variants). Without
        // this, such a page throws "cannot affect row a second time", the run aborts
        // before advancing the cursor, and the crawl wedges on that page forever.
        const byAsin = new Map();
        for (const r of rows) byAsin.set(r.asin, r);
        const deduped = [...byAsin.values()];
        const { error } = await supa.from("campaign_candidates").upsert(deduped, { onConflict: "asin" });
        if (error) { err = `upsert ${category} p${page}: ${error.message.slice(0, 120)}`; break; }
        ups += deduped.length;
      }
      budget--;
      if (!hasMore) { done = true; break; }
      page++;
      await supa.from("discovery_cursor").update({ next_page: page, last_run_at: nowIso }).eq("category", category);
    }

    if (done) {
      await supa.from("discovery_cursor").update({ next_page: 1, exhausted: true, last_run_at: nowIso }).eq("category", category);
    } else {
      await supa.from("discovery_cursor").update({ next_page: page, exhausted: false, last_run_at: nowIso }).eq("category", category);
    }
    perCat[category] = { from_page: st.next_page ?? 1, to_page: page, seen, upserted: ups, done };
    totalSeen += seen; totalUps += ups;
    if (err) break;
    if (budget <= 0 || (Date.now() - started) >= softDeadlineMs) break;
  }

  const { data: curAfter } = await supa.from("discovery_cursor").select("category,exhausted").in("category", categories);
  const allExhausted = (curAfter ?? []).length > 0 && (curAfter ?? []).every((c) => c.exhausted);
  let expired = 0, cycleComplete = false;
  if (allExhausted && !err) {
    cycleComplete = true;
    const cutoff = new Date(Date.now() - EXPIRE_AFTER_DAYS * 86400000).toISOString();
    const { data: exp } = await supa.from("campaign_candidates")
      .update({ status: "expired" }).eq("status", "pending").lt("last_seen_at", cutoff).select("asin");
    expired = (exp ?? []).length;
  }

  return jsonRes({ ok: !err, pid, per_category: perCat, seen: totalSeen, upserted: totalUps, skipped_in_campaign: totalSkip, all_exhausted: allExhausted, cycle_complete: cycleComplete, expired, error: err });
});
