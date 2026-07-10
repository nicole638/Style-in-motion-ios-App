// cj-commissions-sync — v2 (2026-06-06)
//
// Pulls publisher commissions from CJ's GraphQL Commission Detail Service
// (https://commissions.api.cj.com/query), upserts each into cj_commissions
// keyed by commissionId, and writes the maxCommissionId cursor back to
// cj_publisher_config so the next run resumes from there.
//
// Attribution joins back to creators via:
//   cj_commission.shopper_id = ?sid={click_event_id} in our wrap URL
//   = click_events.id (text-cast) → click_events.creator_id
//
// Run nightly via pg_cron OR manually for backfill. Designed to be idempotent;
// re-runs upsert (commissionId is PK) so safe to retry on failure.
//
// Body params:
//   { dry_run: true }                  — fetch + log but don't upsert/advance cursor
//   { reset_cursor: true }             — ignore stored cursor, start from 90 days ago
//   { since_posting_date: "..." }      — override the default sincePostingDate
//
// Pagination contract from CJ schema:
//   While !payloadComplete: re-call with sinceCommissionId = maxCommissionId.
//
// v2 change: always stamp last_sync_at on real runs (was previously gated
// on finalCursor being non-null, which left it null after empty-result runs).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CJ_ENDPOINT = "https://commissions.api.cj.com/query";

const QUERY = `
  query Commissions(
    $forPublishers: [String!]!
    $sinceCommissionId: String
    $sincePostingDate: String
  ) {
    publisherCommissions(
      forPublishers: $forPublishers
      sinceCommissionId: $sinceCommissionId
      sincePostingDate: $sincePostingDate
    ) {
      count
      limit
      maxCommissionId
      payloadComplete
      records {
        commissionId
        shopperId
        advertiserId
        advertiserName
        orderId
        actionStatus
        actionType
        validationStatus
        lockingMethod
        pubCommissionAmountUsd
        pubCommissionAmountPubCurrency
        saleAmountUsd
        saleAmountPubCurrency
        orderDiscountUsd
        eventDate
        clickDate
        postingDate
        lockingDate
        original
        originalActionId
        correctionReason
        reviewedStatus
        aid
        coupon
        concludingBrowser
        concludingDeviceName
        concludingDeviceType
        initiatingBrowser
        initiatingDeviceName
        initiatingDeviceType
        isCrossDevice
        country
        source
        websiteId
        websiteName
      }
    }
  }
`;

type CommissionRecord = {
  commissionId: string;
  shopperId: string | null;
  advertiserId: string;
  advertiserName: string | null;
  orderId: string | null;
  actionStatus: string;
  actionType: string | null;
  validationStatus: string | null;
  lockingMethod: string | null;
  pubCommissionAmountUsd: number | null;
  pubCommissionAmountPubCurrency: number | null;
  saleAmountUsd: number | null;
  saleAmountPubCurrency: number | null;
  orderDiscountUsd: number | null;
  eventDate: string | null;
  clickDate: string | null;
  postingDate: string | null;
  lockingDate: string | null;
  original: boolean | null;
  originalActionId: string | null;
  correctionReason: string | null;
  reviewedStatus: string | null;
  aid: string | null;
  coupon: string | null;
  concludingBrowser: string | null;
  concludingDeviceName: string | null;
  concludingDeviceType: string | null;
  initiatingBrowser: string | null;
  initiatingDeviceName: string | null;
  initiatingDeviceType: string | null;
  isCrossDevice: boolean | null;
  country: string | null;
  source: string | null;
  websiteId: string | null;
  websiteName: string | null;
};

function toRow(r: CommissionRecord) {
  return {
    commission_id: r.commissionId,
    shopper_id: r.shopperId,
    advertiser_id: r.advertiserId,
    advertiser_name: r.advertiserName,
    order_id: r.orderId,
    action_status: r.actionStatus,
    action_type: r.actionType,
    validation_status: r.validationStatus,
    locking_method: r.lockingMethod,
    pub_commission_amount_usd: r.pubCommissionAmountUsd,
    pub_commission_amount_pub_currency: r.pubCommissionAmountPubCurrency,
    sale_amount_usd: r.saleAmountUsd,
    sale_amount_pub_currency: r.saleAmountPubCurrency,
    order_discount_usd: r.orderDiscountUsd,
    event_date: r.eventDate,
    click_date: r.clickDate,
    posting_date: r.postingDate,
    locking_date: r.lockingDate,
    original: r.original,
    original_action_id: r.originalActionId,
    correction_reason: r.correctionReason,
    reviewed_status: r.reviewedStatus,
    aid: r.aid,
    coupon: r.coupon,
    concluding_browser: r.concludingBrowser,
    concluding_device_name: r.concludingDeviceName,
    concluding_device_type: r.concludingDeviceType,
    initiating_browser: r.initiatingBrowser,
    initiating_device_name: r.initiatingDeviceName,
    initiating_device_type: r.initiatingDeviceType,
    is_cross_device: r.isCrossDevice,
    country: r.country,
    source: r.source,
    website_id: r.websiteId,
    website_name: r.websiteName,
    raw: r,
    updated_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });
  if (req.method !== "POST" && req.method !== "GET")
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });

  let body: { dry_run?: boolean; reset_cursor?: boolean; since_posting_date?: string } = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { /* empty body is fine */ }
  }
  const isDryRun = body.dry_run === true;
  const resetCursor = body.reset_cursor === true;

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  const { data: cfg, error: cfgErr } = await supa
    .from("cj_publisher_config")
    .select("cid, personal_access_token, last_sync_max_commission_id")
    .eq("is_default", true)
    .maybeSingle();
  if (cfgErr || !cfg) {
    return new Response(JSON.stringify({
      error: "no_cj_config",
      detail: cfgErr?.message ?? "no default cj_publisher_config row",
    }), { status: 500 });
  }
  if (!cfg.personal_access_token) {
    return new Response(JSON.stringify({ error: "no_pat_on_config" }), { status: 500 });
  }

  let cursor: string | null = resetCursor ? null : (cfg.last_sync_max_commission_id ?? null);

  // For first sync (no cursor), filter by posting date so we don't pull ALL history.
  // Override via since_posting_date in request body if doing a one-off backfill.
  const sincePostingDate = body.since_posting_date
    ?? (cursor ? null : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

  const startMs = Date.now();
  let totalRecords = 0;
  let totalUpserted = 0;
  let pages = 0;
  let finalCursor: string | null = cursor;
  const MAX_PAGES = 100; // safety: 100k records max per run

  while (pages < MAX_PAGES) {
    pages++;

    let gqlResp: Response;
    try {
      gqlResp = await fetch(CJ_ENDPOINT, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${cfg.personal_access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: QUERY,
          variables: {
            forPublishers: [cfg.cid],
            sinceCommissionId: cursor,
            sincePostingDate,
          },
        }),
        signal: AbortSignal.timeout(60000),
      });
    } catch (e) {
      return new Response(JSON.stringify({
        error: "cj_graphql_fetch_threw",
        detail: (e as Error).message,
        pages, totalUpserted,
      }), { status: 502 });
    }

    if (!gqlResp.ok) {
      const txt = await gqlResp.text();
      return new Response(JSON.stringify({
        error: "cj_graphql_http",
        status: gqlResp.status,
        detail: txt.slice(0, 800),
        pages, totalUpserted,
      }), { status: 502 });
    }

    const json: any = await gqlResp.json().catch(() => null);
    if (!json) {
      return new Response(JSON.stringify({ error: "cj_graphql_bad_json", pages, totalUpserted }), { status: 502 });
    }
    if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
      return new Response(JSON.stringify({
        error: "cj_graphql_errors",
        errors: json.errors,
        pages, totalUpserted,
      }), { status: 502 });
    }

    const data = json?.data?.publisherCommissions;
    if (!data) {
      return new Response(JSON.stringify({
        error: "no_publisherCommissions_field",
        body: json,
        pages, totalUpserted,
      }), { status: 502 });
    }

    const records: CommissionRecord[] = data.records ?? [];
    totalRecords += records.length;

    if (records.length > 0 && !isDryRun) {
      const rows = records.map(toRow);
      const { error: upErr } = await supa
        .from("cj_commissions")
        .upsert(rows, { onConflict: "commission_id" });
      if (upErr) {
        return new Response(JSON.stringify({
          error: "upsert_failed",
          detail: upErr.message,
          pages, totalUpserted,
        }), { status: 500 });
      }
      totalUpserted += rows.length;
    }

    finalCursor = data.maxCommissionId ?? cursor;

    // Done condition: API tells us so, or there's nothing more, or pagination didn't advance.
    if (data.payloadComplete === true || records.length === 0 || finalCursor === cursor) {
      break;
    }
    cursor = finalCursor;
  }

  // v2: ALWAYS stamp last_sync_at on real runs (was previously gated on
  // finalCursor being non-null, which left it null after empty-result runs).
  // Cursor only advances if we got a new one.
  if (!isDryRun) {
    const patch: Record<string, unknown> = { last_sync_at: new Date().toISOString() };
    if (finalCursor) patch.last_sync_max_commission_id = finalCursor;
    await supa.from("cj_publisher_config")
      .update(patch)
      .eq("is_default", true);
  }

  return new Response(JSON.stringify({
    ok: true,
    dry_run: isDryRun,
    pages,
    total_records_fetched: totalRecords,
    total_upserted: totalUpserted,
    final_cursor: finalCursor,
    since_posting_date_used: sincePostingDate,
    elapsed_ms: Date.now() - startMs,
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
