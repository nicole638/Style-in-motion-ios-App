// rakuten-events-sync EF — daily backstop for the postback receiver.
//
// Calls GET /events/1.0/transactions?process_date_start=...&process_date_end=...
// with a rolling N-day window (max 29 — Rakuten rejects exactly 30 days back).
// Upserts into commissions table keyed on
// (affiliate_network='rakuten', affiliate_transaction_id=etransaction_id),
// matching the rakuten-postback EF's dedupe pattern.
//
// Why this exists: postbacks can be dropped (network, deploy gaps, dashboard
// misconfig). This EF catches anything we missed. Mirror of awin-performance-sync.
//
// Constraints from Rakuten's API:
//   - process_date_start must be STRICTLY less than 30 days back. Cap at 29.
//   - Date format: YYYY-MM-DD HH:MM:SS (space-separated, no Z).
//   - Rate limit: 100 req/min per scope.
//
// Also: promotes commission status pending→confirmed when order_date is older
// than the merchant's update_window days (default 90).
//
// Query params:
//   ?days=7              window size in days, max 29. default 7.
//   ?sid=<sid>           which SID to use (default: is_default=true)
//   ?advertiser=<mid>    filter to single merchant
//   ?dry_run=1           do everything except upsert; report counts only

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RAKUTEN_API = "https://api.linksynergy.com";
const RAKUTEN_TOKEN_ENDPOINT = "https://api.linksynergy.com/token";
const CACHE_SKEW_MS = 60_000;
const MAX_WINDOW_DAYS = 29; // Rakuten rejects exactly 30 days back
const DEFAULT_UPDATE_WINDOW_DAYS = 90;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

function toRakDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d.\-]/g, "");
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function parseCreatorId(u1: unknown): string | null {
  if (typeof u1 !== "string") return null;
  const t = u1.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return null;
  return t.toLowerCase();
}

interface ConfigRow {
  sid: string; client_id: string; client_secret: string;
  access_token: string | null; access_token_expires_at: string | null;
  refresh_token: string | null;
}
async function loadConfig(sid: string | null): Promise<ConfigRow> {
  let q = supabase.from("rakuten_publisher_config").select("*");
  q = sid ? q.eq("sid", sid) : q.eq("is_default", true);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`config lookup: ${error.message}`);
  if (!data) throw new Error(`no rakuten_publisher_config row`);
  return data as ConfigRow;
}
async function callTokenEndpoint(tokenKey: string, body: URLSearchParams) {
  const res = await fetch(RAKUTEN_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Authorization": `Bearer ${tokenKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`token status=${res.status} body=${await res.text()}`);
  return await res.json() as { access_token: string; refresh_token: string; expires_in: number };
}
async function ensureValidToken(cfg: ConfigRow): Promise<string> {
  const now = Date.now();
  const expiresAt = cfg.access_token_expires_at ? new Date(cfg.access_token_expires_at).getTime() : 0;
  if (cfg.access_token && expiresAt - now > CACHE_SKEW_MS) return cfg.access_token;
  const tokenKey = btoa(`${cfg.client_id}:${cfg.client_secret}`);
  let tok;
  if (cfg.refresh_token) {
    try {
      tok = await callTokenEndpoint(tokenKey, new URLSearchParams({
        grant_type: "refresh_token", refresh_token: cfg.refresh_token, scope: cfg.sid,
      }));
    } catch (e) { console.log(`refresh failed: ${e}`); }
  }
  if (!tok) tok = await callTokenEndpoint(tokenKey, new URLSearchParams({ scope: cfg.sid }));
  const newExp = new Date(Date.now() + tok.expires_in * 1000).toISOString();
  await supabase.from("rakuten_publisher_config").update({
    access_token: tok.access_token, access_token_expires_at: newExp,
    refresh_token: tok.refresh_token, updated_at: new Date().toISOString(),
  }).eq("sid", cfg.sid);
  return tok.access_token;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const days = Math.min(MAX_WINDOW_DAYS, Math.max(1, parseInt(url.searchParams.get("days") ?? "7", 10) || 7));
  const sid = url.searchParams.get("sid");
  const advertiser = url.searchParams.get("advertiser");
  const dryRun = url.searchParams.get("dry_run") === "1";

  const startedAt = new Date();
  const endDate = new Date();
  const startDate = new Date(startedAt.getTime() - days * 24 * 60 * 60 * 1000);

  let cfg: ConfigRow, token: string;
  try {
    cfg = await loadConfig(sid);
    token = await ensureValidToken(cfg);
  } catch (e) {
    return new Response(JSON.stringify({ error: "auth failed", detail: String(e) }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  const params = new URLSearchParams({
    process_date_start: toRakDateString(startDate),
    process_date_end: toRakDateString(endDate),
  });
  if (advertiser) params.set("merchantid", advertiser);

  let transactions: any[] = [];
  try {
    const res = await fetch(`${RAKUTEN_API}/events/1.0/transactions?${params.toString()}`, {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    });
    if (!res.ok) {
      const body = await res.text();
      return new Response(JSON.stringify({
        error: "events_fetch_failed", status: res.status, body: body.slice(0, 500),
        window: { start: toRakDateString(startDate), end: toRakDateString(endDate) },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    const json = await res.json();
    transactions = Array.isArray(json) ? json : (json.transactions ?? []);
  } catch (e) {
    return new Response(JSON.stringify({ error: "events_request_failed", detail: String(e) }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  const { data: merchants } = await supabase.from("rakuten_merchants")
    .select("rakuten_mid, merchant_name, domain, update_window");
  const merchantMap = new Map<string, any>();
  for (const m of (merchants ?? [])) merchantMap.set(String(m.rakuten_mid), m);

  const errors: Array<{ etxn: string; error: string }> = [];
  let upserted = 0, skipped = 0;
  for (const t of transactions) {
    const etxnId = String(t.etransaction_id ?? t.etransactionID ?? t.etxn_id ?? "");
    const txnId = String(t.transaction_id ?? t.transactionID ?? "");
    const dedupeKey = etxnId || txnId;
    if (!dedupeKey) { skipped++; continue; }

    const mid = String(t.mid ?? t.merchant_id ?? "");
    const m = mid ? merchantMap.get(mid) : null;
    const creatorId = parseCreatorId(t.u1 ?? t.U1 ?? null);
    const commissionAmount = toNumber(t.commissions ?? t.commission_amount ?? t.commission);
    const saleAmount = toNumber(t.sale_amount ?? t.salesAmount ?? t.sales_amount);
    const orderDate = t.transaction_date ?? t.process_date ?? t.processDate ?? new Date().toISOString();

    let status: "pending" | "confirmed" | "rejected" = "pending";
    if (commissionAmount !== null && commissionAmount < 0) {
      status = "rejected";
    } else {
      const uw = (m?.update_window ?? DEFAULT_UPDATE_WINDOW_DAYS);
      if (new Date(orderDate).getTime() < Date.now() - uw * 24 * 60 * 60 * 1000) status = "confirmed";
    }

    if (dryRun) { upserted++; continue; }

    const row: Record<string, unknown> = {
      affiliate_network: "rakuten",
      affiliate_transaction_id: dedupeKey,
      creator_id: creatorId,
      merchant_name: m?.merchant_name ?? t.mname ?? null,
      merchant_domain: m?.domain ?? null,
      sale_amount: saleAmount,
      commission_total: commissionAmount,
      order_date: orderDate,
      status,
      confirmed_at: status === "confirmed" ? new Date().toISOString() : null,
    };
    const upsertPayload = Object.fromEntries(
      Object.entries(row).filter(([k, v]) => {
        const alwaysKeep = new Set([
          "affiliate_network", "affiliate_transaction_id",
          "status", "confirmed_at",
          "sale_amount", "commission_total", "order_date",
        ]);
        if (alwaysKeep.has(k)) return true;
        return v !== null && v !== undefined;
      }),
    );

    const { error: upErr } = await supabase
      .from("commissions")
      .upsert(upsertPayload, { onConflict: "affiliate_network,affiliate_transaction_id" });
    if (upErr) errors.push({ etxn: dedupeKey, error: upErr.message });
    else upserted++;
  }

  let promoted = 0;
  if (!dryRun) {
    for (const m of (merchants ?? [])) {
      const window = m.update_window ?? DEFAULT_UPDATE_WINDOW_DAYS;
      const cutoff = new Date(Date.now() - window * 24 * 60 * 60 * 1000).toISOString();
      const { count } = await supabase
        .from("commissions")
        .update({ status: "confirmed", confirmed_at: new Date().toISOString() }, { count: "exact" })
        .eq("affiliate_network", "rakuten")
        .eq("merchant_domain", m.domain)
        .eq("status", "pending")
        .lt("order_date", cutoff);
      promoted += (count ?? 0);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    window: { days, start: toRakDateString(startDate), end: toRakDateString(endDate) },
    transactions_returned: transactions.length,
    upserted, skipped,
    promoted_pending_to_confirmed: promoted,
    errors,
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    dry_run: dryRun,
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});
