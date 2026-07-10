// partnerboost-amazon-report-sync — PartnerBoost Amazon order-conversion report
// (/api/datafeed/get_amazon_report). Dates are YYYYMMDD. Writes per-ASIN/day rows
// into pb_amazon_report (NOT commissions — avoids double-counting the CJ 7096926
// PB-Amazon path). Attributes via uid = our stamped click_event_id.
//
// Body: { days?:int(def 30), start_date?:'YYYYMMDD', end_date?:'YYYYMMDD', dry_run?, debug? }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PB_TOKEN = Deno.env.get("PARTNERBOOST_API_TOKEN") ?? "";
const URL_EP = "https://app.partnerboost.com/api/datafeed/get_amazon_report";
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } }); }
function ymd8(d: Date) { return d.toISOString().slice(0, 10).replace(/-/g, ""); }
function toDate(s: unknown): string | null { const t = String(s ?? ""); if (!/^\d{8}$/.test(t)) return null; return `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}`; }
function num(v: unknown): number | null { if (v === null || v === undefined || v === "") return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; }
function intg(v: unknown): number | null { const n = num(v); return n === null ? null : Math.round(n); }
function str(v: unknown): string | null { if (v === null || v === undefined) return null; const s = String(v).trim(); return s === "" ? null : s; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!PB_TOKEN) return json({ error: "no_PARTNERBOOST_API_TOKEN" }, 500);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const dryRun = body.dry_run === true; const debug = body.debug === true;
  const days = Math.min(60, Math.max(1, parseInt(String(body.days ?? 30), 10) || 30));
  const startDate = str(body.start_date) ?? ymd8(new Date(Date.now() - days * 864e5));
  const endDate = str(body.end_date) ?? ymd8(new Date());

  const startedAt = new Date().toISOString();
  const records: any[] = []; let apiErr: string | null = null; let firstRaw = "";
  let page = 1;
  while (page <= MAX_PAGES) {
    const r = await fetch(URL_EP, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: PB_TOKEN, page_size: PAGE_SIZE, page, start_date: startDate, end_date: endDate }), signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    if (page === 1) firstRaw = text.slice(0, 350);
    let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
    const code = j?.status?.code ?? j?.code;
    if (r.status !== 200 || (code !== 0 && code !== "0")) { apiErr = `page${page}: http=${r.status} code=${code} ${text.slice(0,160)}`; break; }
    const list: any[] = Array.isArray(j?.data?.list) ? j.data.list : (Array.isArray(j?.data) ? j.data : []);
    records.push(...list);
    if (list.length < PAGE_SIZE) break;
    page++;
  }

  // resolve creators via uid (when it's a click_event_id uuid)
  const uids = new Set<string>();
  for (const r of records) { const u = str(r.uid); if (u && UUID_RE.test(u)) uids.add(u.toLowerCase()); }
  const uidToCreator = new Map<string, string>();
  if (uids.size > 0) { const { data: clicks } = await supabase.from("click_events").select("id, creator_id").in("id", [...uids]); for (const c of clicks ?? []) if (c.creator_id) uidToCreator.set(String(c.id), String(c.creator_id)); }

  const rows: any[] = []; let attributed = 0;
  for (const r of records) {
    const asin = str(r.asin); const date = toDate(r.date); const orderId = str(r.order_id);
    const uid = str(r.uid); const adGroupId = str(r.adGroupId ?? r.ad_group_id);
    const creatorId = uid && UUID_RE.test(uid) ? (uidToCreator.get(uid.toLowerCase()) ?? null) : null;
    if (creatorId) attributed++;
    const dedupKey = `${date ?? ""}|${asin ?? ""}|${orderId ?? ""}|${adGroupId ?? ""}|${uid ?? ""}`;
    rows.push({
      dedup_key: dedupKey, order_id: orderId, asin, report_date: date,
      marketplace: str(r.marketplace), currency: str(r.currency),
      est_commission: num(r.estCommission), sales: num(r.sales), quantity: intg(r.quantity),
      conversion_rate: str(r.conversionRate), clicks: intg(r.clicks), add_to_carts: intg(r.addToCarts),
      detail_page_views: intg(r.detailPageViews), product_conversion_type: str(r.productConversionType),
      link: str(r.link), uid, creator_id: creatorId, ad_group_id: adGroupId, raw: r, last_seen_at: startedAt,
    });
  }
  const seen = new Set<string>(); const dedup = rows.filter((r) => seen.has(r.dedup_key) ? false : (seen.add(r.dedup_key), true));

  if (debug || dryRun) return json({ ok: !apiErr, window: { startDate, endDate }, api_error: apiErr, first_raw: debug ? firstRaw : undefined, fetched: records.length, rows: dedup.length, attributed_to_creator: attributed, sample: dedup.slice(0, 3) });
  if (apiErr) return json({ ok: false, api_error: apiErr }, 502);

  let upserted = 0; const errs: string[] = [];
  for (let i = 0; i < dedup.length; i += 200) { const batch = dedup.slice(i, i + 200); const { error } = await supabase.from("pb_amazon_report").upsert(batch, { onConflict: "dedup_key" }); if (error) errs.push(error.message.slice(0, 150)); else upserted += batch.length; }
  return json({ ok: errs.length === 0, window: { startDate, endDate }, fetched: records.length, upserted, attributed_to_creator: attributed, errors: errs });
});
