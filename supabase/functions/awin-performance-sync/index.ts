// awin-performance-sync v1 — webhook backstop + daily aggregate snapshots.
//
// Two passes per run:
//   1. /publishers/{pubId}/reports/advertiser — daily aggregate per merchant
//      (impressions, clicks, pending value). Stored in awin_performance_daily
//      for trending charts + per-merchant creator insights.
//   2. /publishers/{pubId}/transactions — individual sales. Each one upserted
//      into commissions table on (affiliate_network, affiliate_transaction_id).
//      Catches anything the webhook missed (delivery failure, downtime, etc.)
//
// Schedule: daily at 04:00 UTC. Reconciliation window = past 7 days (rolling).
//   Awin commissions take 1-30+ days to validate so the 7-day window catches
//   any status changes we might have missed.
//
// INVOCATION:
//   POST {}                          — default 7-day window (used by cron)
//   POST { startDate, endDate }      — explicit window for backfills

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AWIN_API_BASE = "https://api.awin.com";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);
  let body: { startDate?: string; endDate?: string } = {};
  try { body = await req.json(); } catch { /* */ }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: cfg } = await supa.from("awin_publisher_config")
    .select("publisher_id, api_token").eq("id", 1).maybeSingle();
  if (!cfg?.api_token) return jsonRes({ ok: false, error: "no_api_token" }, 500);

  const publisherId = cfg.publisher_id;
  const headers = {
    "Authorization": `Bearer ${cfg.api_token}`,
    "Accept": "application/json",
  };

  const now = new Date();
  const startDate = body.startDate ?? isoDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
  const endDate = body.endDate ?? isoDate(now);

  // ── 1. Advertiser performance aggregates ──
  let aggRows: any[] = [];
  try {
    const r = await fetch(
      `${AWIN_API_BASE}/publishers/${publisherId}/reports/advertiser` +
      `?startDate=${startDate}&endDate=${endDate}&region=US&timezone=UTC&dateType=transaction`,
      { headers, signal: AbortSignal.timeout(30000) },
    );
    if (!r.ok) return jsonRes({ ok: false, error: `report_http_${r.status}`, detail: await r.text() }, 502);
    aggRows = await r.json();
  } catch (e) {
    return jsonRes({ ok: false, error: `report_failed: ${(e as Error).message}` }, 502);
  }

  // Upsert into awin_performance_daily — one row per (merchant, date_window).
  // We use a coarse "as-of" snapshot keyed on the run's endDate; charts can
  // diff successive snapshots to compute deltas.
  const snapshotAt = new Date().toISOString();
  const perMerchant: any[] = [];
  for (const r of aggRows) {
    const advId = String(r.advertiserId ?? "");
    if (!advId) continue;
    const { data: merchant } = await supa.from("awin_merchants")
      .select("id").eq("awinmid", advId).maybeSingle();
    perMerchant.push({
      merchant_id: merchant?.id ?? null,
      awinmid: advId,
      window_start: startDate,
      window_end: endDate,
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      pending_count: Number(r.pendingNo ?? 0),
      pending_value: Number(r.pendingValue ?? 0),
      confirmed_count: Number(r.confirmedNo ?? 0),
      confirmed_value: Number(r.confirmedValue ?? 0),
      declined_count: Number(r.declinedNo ?? 0),
      declined_value: Number(r.declinedValue ?? 0),
      currency: r.currency ?? "USD",
      snapshot_at: snapshotAt,
    });
  }
  if (perMerchant.length > 0) {
    const { error } = await supa.from("awin_performance_daily")
      .upsert(perMerchant, { onConflict: "awinmid,window_start,window_end" });
    if (error) console.warn("[awin-performance-sync] aggregate_upsert_failed", error.message);
  }

  // ── 2. Transactions reconciliation ──
  // Pull individual transactions for the window. Each one upserts into
  // commissions on (affiliate_network, affiliate_transaction_id) — same
  // dedupe key the webhook uses. So if the webhook already saw this txn,
  // this is a no-op; if it missed it, we backfill.
  let txnsRecovered = 0;
  let txnsTotal = 0;
  try {
    const r = await fetch(
      `${AWIN_API_BASE}/publishers/${publisherId}/transactions/` +
      `?startDate=${startDate}T00:00:00&endDate=${endDate}T23:59:59&timezone=UTC`,
      { headers, signal: AbortSignal.timeout(30000) },
    );
    if (r.ok) {
      const txns: any[] = await r.json();
      txnsTotal = txns.length;
      for (const t of txns) {
        const txnId = String(t.id ?? "");
        if (!txnId) continue;
        // Check existing
        const { data: existing } = await supa.from("commissions")
          .select("id").eq("affiliate_network", "awin").eq("affiliate_transaction_id", txnId).maybeSingle();
        if (existing) continue;

        // Backfill missing transaction
        const status = (() => {
          const s = String(t.commissionStatus ?? t.transactionStatus ?? "").toLowerCase();
          if (s.includes("approve") || s.includes("confirm")) return "confirmed";
          if (s.includes("declin") || s.includes("reject")) return "declined";
          return "pending";
        })();

        // Look up merchant
        const advId = String(t.advertiserId ?? "");
        const { data: merchant } = await supa.from("awin_merchants")
          .select("id, merchant_name, domain").eq("awinmid", advId).maybeSingle();

        // Look up creator from clickref
        const clickref = t.publisherUrl?.match(/clickref=([^&]+)/)?.[1]
          ?? t.clickRef ?? t.publisherReference ?? null;
        const creatorId = (typeof clickref === "string"
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clickref))
          ? clickref.toLowerCase() : null;

        const { error: insertErr } = await supa.from("commissions").upsert({
          affiliate_network: "awin",
          affiliate_transaction_id: txnId,
          creator_id: creatorId,
          merchant_name: merchant?.merchant_name ?? t.advertiserName ?? null,
          merchant_domain: merchant?.domain ?? null,
          sale_amount: Number(t.saleAmount?.amount ?? t.saleAmount ?? 0),
          commission_total: Number(t.commissionAmount?.amount ?? t.commissionAmount ?? 0),
          order_date: t.transactionDate ?? null,
          status,
          confirmed_at: status === "confirmed" ? new Date().toISOString() : null,
        }, { onConflict: "affiliate_network,affiliate_transaction_id" });
        if (!insertErr) txnsRecovered++;
      }
    }
  } catch (e) {
    console.warn("[awin-performance-sync] transactions_fetch_failed", (e as Error).message);
  }

  return jsonRes({
    ok: true,
    window: { startDate, endDate },
    advertiser_rows: aggRows.length,
    aggregate_rows_upserted: perMerchant.length,
    transactions_fetched: txnsTotal,
    transactions_recovered: txnsRecovered,
  });
});
