// rakuten-postback EF — real-time Rakuten transaction receiver.
//
// Rakuten Postback fires a GET (not POST) to a templated callback URL we
// register in the Publisher Dashboard under Reports → Postback. They
// substitute {placeholders} with the actual transaction values.
//
// Recommended template to register in the Rakuten dashboard:
//   https://rghlcnrttvlvphzahudf.supabase.co/functions/v1/rakuten-postback
//     ?secret=<RAKUTEN_POSTBACK_SECRET>
//     &transactionID={transactionID}
//     &etransactionID={etransactionID}
//     &u1={u1}
//     &mid={mid}
//     &advertiserName={advertiserName}
//     &commissions={commissions}
//     &salesAmount={salesAmount}
//     &orderTransactionDate={orderTransactionDate}
//     &processDate={processDate}
//     &sku={sku}
//     &qty={qty}
//     &currency={currency}
//
// IDEMPOTENCY: dedupes on (affiliate_network='rakuten', affiliate_transaction_id=etransactionID).
// STATUS: 'pending' for positive commissions, 'rejected' for negative (refunds).
//   Rakuten doesn't expose explicit confirmed/declined — promotion to 'confirmed'
//   happens in the daily rakuten-events-sync EF after the 90-day update window.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const POSTBACK_SECRET = Deno.env.get("RAKUTEN_POSTBACK_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function txtRes(body: string, status = 200) {
  return new Response(body, { status, headers: { ...CORS, "Content-Type": "text/plain" } });
}
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function toNumber(v: string | null): number | null {
  if (v === null || v === undefined || v === "") return null;
  const cleaned = v.replace(/[^\d.\-]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
function parseCreatorIdFromU1(u1: string | null): string | null {
  if (!u1) return null;
  const trimmed = u1.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return null;
  return trimmed.toLowerCase();
}
function statusFromCommissions(commissions: number | null): "pending" | "confirmed" | "rejected" {
  if (commissions === null) return "pending";
  if (commissions < 0) return "rejected";
  return "pending";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return txtRes("method_not_allowed", 405);

  const url = new URL(req.url);
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams) params[k] = v;

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── 1. Verify shared secret ──
  const providedSecret = params["secret"] ?? "";
  const verified = POSTBACK_SECRET.length > 0 && providedSecret === POSTBACK_SECRET;
  if (POSTBACK_SECRET && !verified) {
    await supa.from("rakuten_postback_events").insert({
      raw_query_string: url.search,
      raw_params: params,
      processing_error: "secret_mismatch",
      processed_at: new Date().toISOString(),
    });
    return txtRes("unauthorized", 401);
  }
  const safeParams = { ...params };
  delete safeParams.secret;

  // ── 2. Identify the event ──
  const txnId = params["transactionID"] ?? params["transactionId"] ?? null;
  const etxnId = params["etransactionID"] ?? params["etransactionId"] ?? params["etransaction_id"] ?? null;
  const isTransaction = !!txnId || !!etxnId;
  const eventType = isTransaction ? "transaction" : "unknown";

  // ── 3. Persist raw event ──
  const { data: logRow, error: logErr } = await supa
    .from("rakuten_postback_events")
    .insert({
      raw_query_string: url.search,
      raw_params: safeParams,
      event_type: eventType,
      rakuten_transaction_id: txnId,
      rakuten_etransaction_id: etxnId,
      rakuten_mid: params["mid"] ?? null,
      verified,
    })
    .select("id")
    .single();

  if (logErr) {
    console.error("[rakuten-postback] log_insert_failed", logErr.message);
    return txtRes("log_failed", 500);
  }

  if (!isTransaction) {
    await supa.from("rakuten_postback_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", logRow.id);
    return txtRes("ok");
  }

  // ── 4. Parse transaction fields ──
  const creatorId = parseCreatorIdFromU1(params["u1"] ?? null);
  const rakutenMid = params["mid"] ?? null;
  const advertiserName = params["advertiserName"] ?? params["mname"] ?? null;
  const saleAmount = toNumber(params["salesAmount"] ?? params["saleAmount"] ?? params["sale_amount"] ?? null);
  const commissionAmount = toNumber(params["commissions"] ?? params["commission"] ?? null);
  const orderDate = params["orderTransactionDate"] ?? params["transactionDate"] ?? params["processDate"] ?? new Date().toISOString();
  const status = statusFromCommissions(commissionAmount);

  // ── 5. Resolve merchant ──
  let merchantDomain: string | null = null;
  let resolvedMerchantName: string | null = advertiserName;
  if (rakutenMid) {
    const { data: m } = await supa
      .from("rakuten_merchants")
      .select("merchant_name, domain")
      .eq("rakuten_mid", rakutenMid)
      .maybeSingle();
    if (m) {
      merchantDomain = m.domain ?? null;
      resolvedMerchantName = m.merchant_name ?? advertiserName;
    }
  }

  // ── 6. Best-effort click_event link ──
  let clickEventId: string | null = null;
  if (creatorId && merchantDomain) {
    const orderIso = new Date(orderDate).toISOString();
    const lookbackStart = new Date(
      new Date(orderDate).getTime() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data: clicks } = await supa
      .from("click_events")
      .select("id")
      .eq("creator_id", creatorId)
      .eq("merchant_domain", merchantDomain)
      .gte("clicked_at", lookbackStart)
      .lte("clicked_at", orderIso)
      .order("clicked_at", { ascending: false })
      .limit(1);
    if (clicks && clicks.length > 0) clickEventId = clicks[0].id;
  }

  // ── 7. Upsert commission ──
  const dedupeKey = etxnId ?? txnId!;
  const commissionRow: Record<string, unknown> = {
    affiliate_network: "rakuten",
    affiliate_transaction_id: dedupeKey,
    creator_id: creatorId,
    click_event_id: clickEventId,
    merchant_name: resolvedMerchantName,
    merchant_domain: merchantDomain,
    sale_amount: saleAmount,
    commission_total: commissionAmount,
    order_date: orderDate,
    status,
    confirmed_at: status === "confirmed" ? new Date().toISOString() : null,
  };
  const upsertPayload = Object.fromEntries(
    Object.entries(commissionRow).filter(([k, v]) => {
      const alwaysKeep = new Set([
        "affiliate_network", "affiliate_transaction_id",
        "status", "confirmed_at",
        "sale_amount", "commission_total", "order_date",
      ]);
      if (alwaysKeep.has(k)) return true;
      return v !== null && v !== undefined;
    }),
  );

  const { data: commission, error: upsertErr } = await supa
    .from("commissions")
    .upsert(upsertPayload, { onConflict: "affiliate_network,affiliate_transaction_id" })
    .select("id")
    .single();

  if (upsertErr) {
    console.error("[rakuten-postback] upsert_failed", { dedupeKey, err: upsertErr.message });
    await supa.from("rakuten_postback_events")
      .update({
        processing_error: `upsert: ${upsertErr.message.slice(0, 400)}`,
        processed_at: new Date().toISOString(),
      })
      .eq("id", logRow.id);
    return txtRes("upsert_failed", 500);
  }

  await supa.from("rakuten_postback_events")
    .update({
      processed_at: new Date().toISOString(),
      commission_id: commission.id,
    })
    .eq("id", logRow.id);

  return jsonRes({
    ok: true,
    event_type: "transaction",
    txn_id: txnId,
    etxn_id: etxnId,
    commission_id: commission.id,
    status,
    creator_attributed: !!creatorId,
    click_event_linked: !!clickEventId,
    verified,
  });
});
