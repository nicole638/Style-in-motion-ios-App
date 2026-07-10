// awin-webhook — receives Awin Transaction Notifications in real time.
//
// Awin POSTs JSON to a configured callback URL whenever:
//   - a new transaction is recorded (status='pending')
//   - a transaction status changes (pending→approved or pending→declined)
//   - optionally: clicks and product feed updates
//
// We persist the raw payload to awin_webhook_events for audit + replay,
// parse the relevant fields, and upsert into the commissions table
// keyed on (affiliate_network='awin', affiliate_transaction_id) so
// re-deliveries don't create duplicates.
//
// SECURITY:
//   verify_jwt=false because Awin can't carry a Supabase JWT. Instead
//   we verify the optional shared-secret header AWIN_WEBHOOK_SECRET
//   (configured in the Awin dashboard's "Custom HTTP header" field
//   when registering the callback URL). If unset, we still accept the
//   call but log it as unverified — useful during initial setup before
//   you've wired the secret on Awin's side.
//
// IDEMPOTENCY:
//   Awin re-sends the same transactionId as it moves through
//   pending→approved→declined. Our upsert keys on
//   (affiliate_network, affiliate_transaction_id) and updates status,
//   confirmed_at, and commission_total on conflict. creator_id +
//   merchant_name stay stable from the first delivery.
//
// CREATOR ATTRIBUTION:
//   Our wrap.ts puts the creator's UUID in `clickref`. Awin echoes that
//   value back as `clickRef` (or `publisherReference`) on the
//   transaction. We look that up directly as creator_id — no need to
//   join click_events for attribution.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("AWIN_WEBHOOK_SECRET") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-awin-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/**
 * Parse a commission rate string like "20.00" or "20.0" or "20%" or numeric.
 * Awin sends commissionAmount as numeric in the payload, but the rate
 * percentage on the merchant row is what we use for split math.
 */
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

/**
 * Look up the creator_id directly from the clickref field. We stamp
 * auth.uid() (the creator's UUID) as clickref when we wrap a URL via
 * lib/awin/wrap.ts. Validates UUID shape before returning so bad data
 * doesn't poison the commissions table.
 */
function parseCreatorIdFromClickref(clickref: unknown): string | null {
  if (typeof clickref !== "string") return null;
  const trimmed = clickref.trim();
  // RFC 4122 UUID v4ish pattern — we don't strictly check version digit.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

/**
 * Map Awin's transactionStatus to our commissions.status:
 *   pending  — booked but not approved yet (creator sees "pending" earnings)
 *   approved— confirmed (creator sees "confirmed")
 *   declined— returned or rejected (creator's pending amount drops)
 */
function mapStatus(awinStatus: unknown): "pending" | "confirmed" | "declined" {
  if (typeof awinStatus !== "string") return "pending";
  const s = awinStatus.toLowerCase().trim();
  if (s.includes("approve") || s.includes("confirm")) return "confirmed";
  if (s.includes("declin") || s.includes("reject") || s.includes("cancel")) {
    return "declined";
  }
  return "pending";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST")
    return jsonRes({ error: "method_not_allowed" }, 405);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── 1. Read raw payload + signature ────────────────────────────
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-awin-signature") ?? null;

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Log the bad payload anyway so we can debug.
    await supa.from("awin_webhook_events").insert({
      raw_payload: { _raw_body: rawBody.slice(0, 8000) },
      signature_header: signatureHeader,
      processing_error: "bad_json",
      processed_at: new Date().toISOString(),
    });
    return jsonRes({ error: "bad_json" }, 400);
  }

  // ── 2. Optional shared-secret verification ──────────────────────
  // If you set AWIN_WEBHOOK_SECRET in Supabase Function Secrets AND
  // configure the same value in Awin's "Custom HTTP header" field, we
  // verify on every call. Otherwise we accept but flag the event.
  let verified = false;
  if (WEBHOOK_SECRET) {
    const provided = req.headers.get("x-awin-webhook-secret") ?? "";
    verified = provided === WEBHOOK_SECRET;
    if (!verified) {
      await supa.from("awin_webhook_events").insert({
        raw_payload: payload,
        signature_header: signatureHeader,
        processing_error: "signature_mismatch",
        processed_at: new Date().toISOString(),
      });
      return jsonRes({ error: "signature_mismatch" }, 401);
    }
  }

  // ── 3. Detect event type ───────────────────────────────────
  // Awin's payload shape varies by event type:
  //   - transaction: has transactionId, advertiserId, commissionAmount, ...
  //   - click: has clickId, advertiserId, clickRef, ...
  //   - productFeed: has feedId, ...
  // We only act on transactions in v1; other types are logged and ack'd.
  const txnId =
    payload.transactionId ??
    payload.id ??
    payload.awinTransactionId ??
    null;
  const isTransaction = txnId != null;
  const eventType = isTransaction
    ? "transaction"
    : payload.clickId
      ? "click"
      : "unknown";

  // Always log the raw payload first — we want every Awin event
  // captured even if downstream processing later fails.
  const { data: logRow, error: logErr } = await supa
    .from("awin_webhook_events")
    .insert({
      raw_payload: payload,
      signature_header: signatureHeader,
      event_type: eventType,
      awin_transaction_id: txnId ? String(txnId) : null,
    })
    .select("id")
    .single();

  if (logErr) {
    console.error("[awin-webhook] log_insert_failed", { err: logErr.message });
    return jsonRes({ ok: false, error: "log_failed" }, 500);
  }

  if (!isTransaction) {
    // Click / product feed / unknown — ack 200 so Awin doesn't retry.
    await supa
      .from("awin_webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", logRow.id);
    return jsonRes({ ok: true, event_type: eventType, logged: true });
  }

  // ── 4. Parse transaction fields ─────────────────────────────
  // Awin payload field names vary slightly between API versions and the
  // dashboard's manual export. We accept the common aliases.
  const clickref =
    payload.clickRef ??
    payload.clickref ??
    payload.publisherReference ??
    payload.publisherClickref ??
    null;
  const creatorId = parseCreatorIdFromClickref(clickref);

  const advertiserId = String(
    payload.advertiserId ?? payload.publisherId ?? payload.advertiser ?? "",
  );
  const advertiserName: string | null =
    payload.advertiserName ?? payload.merchantName ?? null;

  const saleAmount = toNumber(
    payload.saleAmount ??
      payload.amount?.amount ??
      payload.transactionAmount ??
      null,
  );
  const commissionAmount = toNumber(
    payload.commissionAmount ??
      payload.commission?.amount ??
      payload.publisherCommission ??
      null,
  );

  const transactionDate =
    payload.transactionDate ??
    payload.clickDate ??
    payload.bookingDate ??
    new Date().toISOString();

  const status = mapStatus(
    payload.transactionStatus ?? payload.status ?? payload.commissionStatus,
  );

  // Look up merchant_domain from awin_merchants by advertiserId so the
  // earnings dashboard shows the correct brand pill.
  let merchantDomain: string | null = null;
  let resolvedMerchantName: string | null = advertiserName;
  if (advertiserId) {
    const { data: m } = await supa
      .from("awin_merchants")
      .select("merchant_name, domain")
      .eq("awinmid", advertiserId)
      .maybeSingle();
    if (m) {
      merchantDomain = m.domain ?? null;
      // Prefer our stored merchant_name over Awin's advertiserName for
      // display consistency — ours matches what creators see in the UI.
      resolvedMerchantName = m.merchant_name ?? advertiserName;
    }
  }

  // Optional: find the click_event that this transaction came from.
  // Match on (creator_id, merchant_domain) within ~30 days before the
  // transaction. Awin's cookie window is normally 30 days. This is a
  // best-effort link so the earnings dashboard can show which look /
  // item the sale came from. NULL if no click_events match (the click
  // may predate our pipeline or have been pruned).
  let clickEventId: string | null = null;
  if (creatorId && merchantDomain) {
    const txnDateIso = new Date(transactionDate).toISOString();
    const thirtyDaysBefore = new Date(
      new Date(transactionDate).getTime() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data: clicks } = await supa
      .from("click_events")
      .select("id")
      .eq("creator_id", creatorId)
      .eq("merchant_domain", merchantDomain)
      .gte("clicked_at", thirtyDaysBefore)
      .lte("clicked_at", txnDateIso)
      .order("clicked_at", { ascending: false })
      .limit(1);
    if (clicks && clicks.length > 0) clickEventId = clicks[0].id;
  }

  // ── 5. Upsert into commissions ──────────────────────────────
  // Keyed on (affiliate_network, affiliate_transaction_id). The unique
  // index uq_commissions_network_txn enforces idempotency — re-deliveries
  // of the same txn (pending→approved status updates) just update the row.
  const commissionRow: Record<string, unknown> = {
    affiliate_network: "awin",
    affiliate_transaction_id: String(txnId),
    creator_id: creatorId,
    click_event_id: clickEventId,
    merchant_name: resolvedMerchantName,
    merchant_domain: merchantDomain,
    sale_amount: saleAmount,
    commission_total: commissionAmount,
    order_date: transactionDate,
    status,
    confirmed_at: status === "confirmed" ? new Date().toISOString() : null,
  };

  // Strip nulls so we don't overwrite existing values on re-delivery
  // with NULL when Awin only sends a subset of fields on status updates.
  // Status, confirmed_at, sale_amount, commission_total can move; keep
  // those explicit so updates land. Identifying fields (network, txn_id)
  // are the ON CONFLICT keys.
  const upsertPayload = Object.fromEntries(
    Object.entries(commissionRow).filter(([k, v]) => {
      // Always keep these even when null — they're updateable.
      const alwaysKeep = new Set([
        "affiliate_network",
        "affiliate_transaction_id",
        "status",
        "confirmed_at",
        "sale_amount",
        "commission_total",
        "order_date",
      ]);
      if (alwaysKeep.has(k)) return true;
      return v !== null && v !== undefined;
    }),
  );

  const { data: commission, error: upsertErr } = await supa
    .from("commissions")
    .upsert(upsertPayload, {
      onConflict: "affiliate_network,affiliate_transaction_id",
    })
    .select("id")
    .single();

  if (upsertErr) {
    console.error("[awin-webhook] commission_upsert_failed", {
      txnId,
      err: upsertErr.message,
    });
    await supa
      .from("awin_webhook_events")
      .update({
        processing_error: `upsert: ${upsertErr.message.slice(0, 400)}`,
        processed_at: new Date().toISOString(),
      })
      .eq("id", logRow.id);
    return jsonRes(
      { ok: false, error: "commission_upsert_failed", detail: upsertErr.message },
      500,
    );
  }

  // Link the audit log row back to the commission for traceability.
  await supa
    .from("awin_webhook_events")
    .update({
      processed_at: new Date().toISOString(),
      commission_id: commission.id,
    })
    .eq("id", logRow.id);

  return jsonRes({
    ok: true,
    event_type: "transaction",
    txn_id: txnId,
    commission_id: commission.id,
    status,
    creator_attributed: !!creatorId,
    click_event_linked: !!clickEventId,
    verified,
  });
});
