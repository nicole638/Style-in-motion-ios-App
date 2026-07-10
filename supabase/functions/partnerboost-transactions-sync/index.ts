// partnerboost-transactions-sync — reconciles PartnerBoost DTC + Walmart
// conversions into commissions. Mirrors rakuten-events-sync. v2: SubID read-back
// now leads with PartnerBoost's confirmed `uid` (+ click_ref, uid2-5) per the
// Global Postback spec, then legacy fallbacks.
//
// Endpoint: POST app.partnerboost.com/api.php?mod=medium&op=transaction
//   body { token, begin_date, end_date(YYYY-MM-DD), page_num }; window cap 62 days.
// Writes commissions (affiliate_network='partnerboost'), dedupe on order/txn id.
//
// Body: { days?:int(<=62,def 60), begin_date?, end_date?, dry_run?:bool }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PB_TOKEN = Deno.env.get("PARTNERBOOST_API_TOKEN") ?? "";
const PB_TXN_URL = "https://app.partnerboost.com/api.php?mod=medium&op=transaction";
const MAX_DAYS = 62;
const MAX_PAGES = 20;

function jsonRes(b: unknown, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } }); }
function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") { const n = parseFloat(v.replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; }
  return null;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function firstDefined(o: any, keys: string[]): unknown { for (const k of keys) { if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; } return null; }
const K_TXN   = ["order_id","transaction_id","trans_id","oid","id","order_sn"];
const K_SALE  = ["sale_amount","order_amount","sales","amount","order_value","gmv"];
const K_COMM  = ["sale_comm","commission","commission_amount","payout","profit","earnings","pub_commission"];
const K_STAT  = ["status","order_status","trans_status","state"];
const K_DATE  = ["order_time","order_date","trans_time","transaction_date","created","created_at","click_time"];
const K_MNAME = ["merchant_name","brand_name","advertiser","advertiser_name","merchant","mname"];
const K_MID   = ["brand_id","mid","advertiser_id","mcid"];
// PartnerBoost SubID = uid (confirmed via Global Postback); then siblings + legacy.
const K_SUBID = ["uid","click_ref","uid2","uid3","uid4","uid5","sub_id","subid","sub1","aff_sub","u1","sid","unique_id","site_id","sub"];

function mapStatus(raw: unknown, commission: number | null): "pending" | "confirmed" | "rejected" {
  if (commission !== null && commission < 0) return "rejected";
  const s = String(raw ?? "").toLowerCase();
  if (/approv|confirm|paid|valid|locked|closed/.test(s)) return "confirmed";
  if (/reject|declin|cancel|invalid|void|refund/.test(s)) return "rejected";
  return "pending";
}

async function pbTxnPage(token: string, begin: string, end: string, page: number) {
  const r = await fetch(PB_TXN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, begin_date: begin, end_date: end, page_num: page }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* */ }
  return { status: r.status, j, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (!PB_TOKEN) return jsonRes({ error: "no_PARTNERBOOST_API_TOKEN" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const dryRun = body.dry_run === true;
  const days = Math.min(MAX_DAYS, Math.max(1, parseInt(String(body.days ?? 60), 10) || 60));
  const end = body.end_date ?? ymd(new Date());
  const begin = body.begin_date ?? ymd(new Date(Date.now() - days * 864e5));

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: merchants } = await supa.from("partnerboost_merchants").select("pb_brand_id, mcid, merchant_name, domain");
  const byBrandId = new Map<string, any>();
  for (const m of merchants ?? []) {
    if (m.pb_brand_id) byBrandId.set(String(m.pb_brand_id), m);
    if (m.mcid) byBrandId.set(String(m.mcid), m);
  }

  const allRecords: any[] = [];
  const perPage: any[] = [];
  let page = 1, totalPage = 1, apiErr: string | null = null;
  while (page <= Math.min(MAX_PAGES, totalPage)) {
    const { status, j, text } = await pbTxnPage(PB_TOKEN, begin, end, page);
    const code = j?.status?.code ?? j?.code;
    if (status !== 200 || code !== 0) { apiErr = `page${page}: http=${status} code=${code} ${(text||"").slice(0,150)}`; break; }
    const list: any[] = Array.isArray(j?.data?.list) ? j.data.list : [];
    totalPage = parseInt(String(j?.data?.total_page ?? 1), 10) || 1;
    perPage.push({ page, got: list.length, total_page: totalPage, total_items: j?.data?.total_items });
    allRecords.push(...list);
    if (list.length === 0) break;
    page++;
  }

  await supa.from("pb_transactions_probe").insert({
    http_status: 200,
    api_code: apiErr ? "sync_err" : "0",
    row_count: allRecords.length,
    record_keys: allRecords[0] && typeof allRecords[0] === "object" ? Object.keys(allRecords[0]) : null,
    raw: { source: "sync", window: { begin, end }, error: apiErr },
    sample: allRecords.slice(0, 3),
  });

  const subIds = new Set<string>();
  for (const r of allRecords) {
    const s = firstDefined(r, K_SUBID);
    if (typeof s === "string" && UUID_RE.test(s.trim())) subIds.add(s.trim().toLowerCase());
  }
  const clickToCreator = new Map<string, string>();
  if (subIds.size > 0) {
    const { data: clicks } = await supa.from("click_events").select("id, creator_id").in("id", [...subIds]);
    for (const c of clicks ?? []) if (c.creator_id) clickToCreator.set(String(c.id), String(c.creator_id));
  }

  let upserted = 0, attributed = 0, skipped = 0;
  const errors: string[] = [];
  for (const r of allRecords) {
    const txnId = firstDefined(r, K_TXN);
    if (!txnId) { skipped++; continue; }
    const commission = num(firstDefined(r, K_COMM));
    const sale = num(firstDefined(r, K_SALE));
    const status = mapStatus(firstDefined(r, K_STAT), commission);
    const sub = firstDefined(r, K_SUBID);
    const subStr = typeof sub === "string" ? sub.trim().toLowerCase() : null;
    const clickEventId = subStr && UUID_RE.test(subStr) ? subStr : null;
    const creatorId = clickEventId ? (clickToCreator.get(clickEventId) ?? null) : null;
    if (creatorId) attributed++;
    const mid = firstDefined(r, K_MID);
    const m = mid ? byBrandId.get(String(mid)) : null;
    const dateRaw = firstDefined(r, K_DATE);
    const orderDate = dateRaw ? new Date(String(dateRaw).replace(" ", "T")).toISOString() : new Date().toISOString();

    if (dryRun) { upserted++; continue; }

    const row: Record<string, unknown> = {
      affiliate_network: "partnerboost",
      affiliate_transaction_id: String(txnId),
      creator_id: creatorId,
      click_event_id: clickEventId,
      merchant_name: m?.merchant_name ?? (firstDefined(r, K_MNAME) as string ?? null),
      merchant_domain: m?.domain ?? null,
      sale_amount: sale,
      commission_total: commission,
      order_date: orderDate,
      status,
      confirmed_at: status === "confirmed" ? new Date().toISOString() : null,
    };
    const payload = Object.fromEntries(Object.entries(row).filter(([k, v]) => {
      const keep = new Set(["affiliate_network","affiliate_transaction_id","status","confirmed_at","sale_amount","commission_total","order_date","creator_id","click_event_id"]);
      return keep.has(k) || (v !== null && v !== undefined);
    }));
    const { error } = await supa.from("commissions")
      .upsert(payload, { onConflict: "affiliate_network,affiliate_transaction_id" });
    if (error) errors.push(`${txnId}: ${error.message.slice(0,120)}`); else upserted++;
  }

  return jsonRes({
    ok: !apiErr, window: { begin, end, days }, dry_run: dryRun,
    pages: perPage, api_error: apiErr,
    records_fetched: allRecords.length,
    upserted, attributed_to_creator: attributed, skipped,
    errors: errors.slice(0, 10),
  });
});
