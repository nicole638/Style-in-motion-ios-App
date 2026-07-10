// partnerboost-acc-products-sync — PartnerBoost Amazon Creator Connection ASIN
// list (/api/datafeed/get_latest_acc_products). Writes ASIN-level rows (with ACC
// campaign budget/spend) into pb_acc_products. Non-disruptive to the existing
// React-fiber cc_campaigns pipeline. (Was 1008 'no permission' — debug shows if enabled.)
//
// Body: { dry_run?:bool, debug?:bool, page_size?:int }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PB_TOKEN = Deno.env.get("PARTNERBOOST_API_TOKEN") ?? "";
const URL_EP = "https://app.partnerboost.com/api/datafeed/get_latest_acc_products";
const MAX_PAGES = 30;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } }); }
function num(v: unknown): number | null { if (v === null || v === undefined || v === "") return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; }
function str(v: unknown): string | null { if (v === null || v === undefined) return null; const s = String(v).trim(); return s === "" ? null : s; }
function toTs(v: unknown): string | null { const s = str(v); if (!s) return null; const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
function toDate(v: unknown): string | null { const s = str(v); if (!s) return null; const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!PB_TOKEN) return json({ error: "no_PARTNERBOOST_API_TOKEN" }, 500);
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const dryRun = body.dry_run === true; const debug = body.debug === true;
  const pageSize = Math.min(2000, Math.max(1, parseInt(String(body.page_size ?? 200), 10) || 200));

  const startedAt = new Date().toISOString();
  const records: any[] = []; let apiErr: string | null = null; let firstRaw = "";
  let page = 1;
  while (page <= MAX_PAGES) {
    const r = await fetch(URL_EP, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: PB_TOKEN, page_size: pageSize, page }), signal: AbortSignal.timeout(30000) });
    const text = await r.text();
    if (page === 1) firstRaw = text.slice(0, 300);
    let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
    const code = j?.status?.code ?? j?.code;
    if (r.status !== 200 || (code !== 0 && code !== "0")) { apiErr = `page${page}: http=${r.status} code=${code} ${text.slice(0,160)}`; break; }
    const list: any[] = Array.isArray(j?.data?.list) ? j.data.list : (Array.isArray(j?.data) ? j.data : []);
    records.push(...list);
    if (list.length < pageSize) break;
    page++;
  }

  const rows: any[] = [];
  for (const c of records) {
    const campaignId = str(c.acc_campaign_id); const asin = str(c.asin);
    rows.push({
      dedup_key: `${campaignId ?? ""}|${asin ?? ""}`,
      acc_campaign_id: campaignId, bid: str(c.bid), brand_name: str(c.brand_name), asin,
      commission: num(c.commission), start_date: toTs(c.start_date), end_date: toTs(c.end_date),
      acc_commission_rate: num(c.acc_commission_rate), acc_start_date: toDate(c.acc_start_date), acc_end_date: toDate(c.acc_end_date),
      acc_budget: num(c.acc_budget), acc_spend: num(c.acc_spend), acc_currency: str(c.acc_currency),
      raw: c, last_seen_at: startedAt,
    });
  }
  const seen = new Set<string>(); const dedup = rows.filter((r) => r.dedup_key !== "|" && (seen.has(r.dedup_key) ? false : (seen.add(r.dedup_key), true)));

  if (debug || dryRun) return json({ ok: !apiErr, api_error: apiErr, first_raw: debug ? firstRaw : undefined, fetched: records.length, rows: dedup.length, distinct_campaigns: new Set(dedup.map((r) => r.acc_campaign_id)).size, sample: dedup.slice(0, 3) });
  if (apiErr) return json({ ok: false, api_error: apiErr }, 502);

  let upserted = 0; const errs: string[] = [];
  for (let i = 0; i < dedup.length; i += 200) { const batch = dedup.slice(i, i + 200); const { error } = await supabase.from("pb_acc_products").upsert(batch, { onConflict: "dedup_key" }); if (error) errs.push(error.message.slice(0, 150)); else upserted += batch.length; }
  return json({ ok: errs.length === 0, fetched: records.length, upserted, distinct_campaigns: new Set(dedup.map((r) => r.acc_campaign_id)).size, errors: errs });
});
