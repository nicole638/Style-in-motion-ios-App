// partnerboost-coupons-sync v3 — PartnerBoost Coupon API (CORRECT endpoint per
// console spec: mod=coupon&op=coupon_list). Writes coupons/deals into
// brand_offers (network='partnerboost', source='api'). Coupon token comes from
// partnerboost_coupon_config (per-channel). Resolves merchant_id via
// partnerboost_merchants brand_id / mcid / domain. Skips expired. Tombstones unseen.
//
// Response: { data:[ {id,brand_id,mcid,advertiser_name,coupon_name,coupon_code,
//   description,restrictions,click_url,origin_url,store_domain,type,country,
//   origin_category,start_at,end_at,...} ], total:"N" }
//
// Body: { dry_run?:bool, debug?:bool, channel_id?:str, per_page?:int }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PB_COUPON_URL = "https://app.partnerboost.com/api.php?mod=coupon&op=coupon_list";
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } }); }
function normDomain(d: string | null): string | null { if (!d) return null; return d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim() || null; }
function toIso(v: unknown): string | null { if (!v) return null; const t = Date.parse(String(v).replace(" ", "T")); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
function str(v: unknown): string | null { if (v === null || v === undefined) return null; const s = String(v).trim(); return s === "" ? null : s; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const dryRun = body.dry_run === true; const debug = body.debug === true;
  const perPage = Math.min(2000, Math.max(1, parseInt(String(body.per_page ?? 2000), 10) || 2000));

  let cfgQ = supabase.from("partnerboost_coupon_config").select("coupon_token, channel_id");
  cfgQ = body.channel_id ? cfgQ.eq("channel_id", body.channel_id) : cfgQ.eq("is_default", true);
  const { data: cfg } = await cfgQ.maybeSingle();
  if (!cfg?.coupon_token) return json({ error: "no_coupon_token" }, 500);
  const token = cfg.coupon_token;

  const { data: merchants } = await supabase.from("partnerboost_merchants").select("id, pb_brand_id, mcid, domain");
  const byBrand = new Map<string, string>(), byMcid = new Map<string, string>(), byDomain = new Map<string, string>();
  for (const m of merchants ?? []) { if (m.pb_brand_id) byBrand.set(String(m.pb_brand_id), String(m.id)); if (m.mcid) byMcid.set(String(m.mcid).toLowerCase(), String(m.id)); const nd = normDomain(m.domain); if (nd) byDomain.set(nd, String(m.id)); }

  const startedAt = new Date().toISOString();
  const records: any[] = []; let total = 0; let apiErr: string | null = null; let firstRaw = "";
  let page = 1;
  while (page <= 20) {
    const r = await fetch(PB_COUPON_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, per_page: perPage, page }), signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    if (page === 1) firstRaw = text.slice(0, 400);
    let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
    const data = Array.isArray(j?.data) ? j.data : null;
    if (!data) { apiErr = `page${page}: http=${r.status} ${text.slice(0, 200)}`; break; }
    total = parseInt(String(j.total ?? data.length), 10) || data.length;
    records.push(...data);
    if (data.length === 0 || records.length >= total) break;
    page++;
  }

  const rows: any[] = []; let unmatched = 0, expired = 0;
  for (const c of records) {
    const brandId = str(c.brand_id); const mcid = str(c.mcid); const domain = normDomain(str(c.store_domain));
    const merchantId = (brandId && byBrand.get(brandId)) || (mcid && byMcid.get(mcid.toLowerCase())) || (domain && byDomain.get(domain)) || null;
    if (!merchantId) unmatched++;
    const endIso = toIso(c.end_at); const startIso = toIso(c.start_at);
    if (endIso && Date.parse(endIso) < Date.now()) { expired++; continue; }
    const id = str(c.id); if (!id) continue;
    const code = str(c.coupon_code);
    const rawType = (str(c.type) ?? "coupon").toLowerCase();
    const type = rawType === "no_code" ? "deal" : (rawType === "deal" ? "deal" : "coupon");
    let status = "active";
    if (startIso && Date.parse(startIso) > Date.now()) status = "upcoming";
    else if (endIso && Date.parse(endIso) - Date.now() < 7 * 864e5) status = "expiringSoon";
    rows.push({
      promotion_id: `pb:api:${id}`, merchant_id: merchantId, network: "partnerboost", network_mid: brandId,
      source: "api", type, title: (str(c.coupon_name) ?? str(c.description) ?? "Offer").slice(0, 300),
      description: str(c.description) ? String(c.description).slice(0, 1024) : null,
      terms: str(c.restrictions) ? String(c.restrictions).slice(0, 4000) : null, voucher_code: code,
      start_date: startIso, end_date: endIso, status,
      url: str(c.origin_url), url_tracking: str(c.click_url), exclusive: false, all_regions: true,
      categories: str(c.origin_category) ? [String(c.origin_category)] : [],
      last_seen_at: startedAt, removed_at: null, updated_at: startedAt,
    });
  }
  const seen = new Set<string>(); const dedup = rows.filter((r) => seen.has(r.promotion_id) ? false : (seen.add(r.promotion_id), true));

  if (debug || dryRun) return json({ ok: !apiErr, channel: cfg.channel_id, api_error: apiErr, first_raw: debug ? firstRaw : undefined, total_reported: total, fetched: records.length, active_after_filter: dedup.length, expired_skipped: expired, unmatched_merchant: unmatched, sample: dedup.slice(0, 4) });
  if (apiErr) return json({ ok: false, api_error: apiErr }, 502);

  let upserted = 0; const errs: string[] = [];
  for (let i = 0; i < dedup.length; i += 200) { const batch = dedup.slice(i, i + 200); const { error } = await supabase.from("brand_offers").upsert(batch, { onConflict: "promotion_id" }); if (error) errs.push(error.message.slice(0, 150)); else upserted += batch.length; }
  const { data: tomb } = await supabase.from("brand_offers").update({ removed_at: startedAt, updated_at: startedAt }).eq("network", "partnerboost").eq("source", "api").is("removed_at", null).lt("last_seen_at", startedAt).select("id");
  return json({ ok: errs.length === 0, channel: cfg.channel_id, total_reported: total, fetched: records.length, upserted, expired_skipped: expired, unmatched_merchant: unmatched, tombstoned: tomb?.length ?? 0, errors: errs });
});
