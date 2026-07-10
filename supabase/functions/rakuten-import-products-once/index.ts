// rakuten-import-products-once EF
// Mirror of awin-import-products-once.
// The SFTP bridge service POSTs here with a merchant's parsed catalog after
// it pulls the file from aftp.linksynergy.com. Bulk-upserts products, then
// tombstones any rows whose last_seen_at is older than the run start time.
//
// Auth: verify_jwt=true. Bridge passes the Supabase anon key in the Authorization header.
//
// Request body:
//   {
//     // merchant identifier — either of these works
//     merchant_id: <uuid>,        // rakuten_merchants.id
//     rakuten_mid: "13867",       // OR rakuten_merchants.rakuten_mid (string)
//
//     // feed metadata
//     sftp_filename?: string,     // for audit
//     bytes_downloaded?: number,
//     full_feed?: boolean,        // default true — if true, tombstones missing rows; if false, just upserts
//
//     // payload
//     products: Array<{
//       product_id_in_feed: string,  // REQUIRED — Rakuten product ID / SKU
//       sku?: string,
//       name?: string,
//       description?: string,
//       brand?: string,
//       category?: string,
//       merchant_category?: string,
//       price?: number,
//       search_price?: number,
//       rrp_price?: number,
//       currency?: string,
//       in_stock?: boolean,
//       product_url?: string,
//       rakuten_deep_link?: string,
//       image_urls?: string[],
//       lifestyle_image_url?: string,
//     }>
//   }
//
// Response:
//   { ok, feed_run_id, seen, inserted_or_updated, tombstoned, errors[] }
//
// Performance: batches upserts in chunks of 250.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH_SIZE = 250;
const MAX_IMAGE_URLS = 6;

interface IncomingProduct {
  product_id_in_feed: string;
  sku?: string | null;
  name?: string | null;
  description?: string | null;
  brand?: string | null;
  category?: string | null;
  merchant_category?: string | null;
  price?: number | null;
  search_price?: number | null;
  rrp_price?: number | null;
  currency?: string | null;
  in_stock?: boolean | null;
  product_url?: string | null;
  rakuten_deep_link?: string | null;
  image_urls?: string[] | null;
  lifestyle_image_url?: string | null;
}

interface IncomingPayload {
  merchant_id?: string;
  rakuten_mid?: string | number;
  sftp_filename?: string;
  bytes_downloaded?: number;
  full_feed?: boolean;
  products: IncomingProduct[];
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sanitizeImageUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  return urls
    .filter((u): u is string => typeof u === "string" && u.length > 0 && u.length <= 2048)
    .slice(0, MAX_IMAGE_URLS);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  let body: IncomingPayload;
  try {
    body = await req.json();
  } catch {
    return jsonRes({ error: "invalid_json" }, 400);
  }

  if (!Array.isArray(body.products)) {
    return jsonRes({ error: "missing_products_array" }, 400);
  }
  if (!body.merchant_id && !body.rakuten_mid) {
    return jsonRes({ error: "missing_merchant_identifier" }, 400);
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── 1. Resolve merchant ──
  let merchantId = body.merchant_id ?? null;
  let merchantRow: { id: string; rakuten_mid: string; merchant_name: string } | null = null;
  {
    let q = supa.from("rakuten_merchants").select("id, rakuten_mid, merchant_name");
    q = merchantId
      ? q.eq("id", merchantId)
      : q.eq("rakuten_mid", String(body.rakuten_mid));
    const { data, error } = await q.maybeSingle();
    if (error) return jsonRes({ error: "merchant_lookup_failed", detail: error.message }, 500);
    if (!data) return jsonRes({
      error: "merchant_not_found",
      hint: "Run rakuten-advertisers-sync first to populate rakuten_merchants.",
      provided: { merchant_id: body.merchant_id, rakuten_mid: body.rakuten_mid },
    }, 404);
    merchantRow = data;
    merchantId = data.id;
  }

  // ── 2. Open a feed run for audit ──
  const startedAt = new Date().toISOString();
  const { data: runRow, error: runErr } = await supa
    .from("rakuten_feed_runs")
    .insert({
      merchant_id: merchantId,
      started_at: startedAt,
      sftp_filename: body.sftp_filename ?? null,
      bytes_downloaded: body.bytes_downloaded ?? null,
      products_seen: body.products.length,
    })
    .select("id")
    .single();
  if (runErr) return jsonRes({ error: "feed_run_insert_failed", detail: runErr.message }, 500);
  const feedRunId = runRow.id;

  // ── 3. Bulk upsert in batches ──
  const errors: Array<{ batch: number; error: string }> = [];
  let totalUpserted = 0;
  let totalSkipped = 0;

  for (let i = 0; i < body.products.length; i += BATCH_SIZE) {
    const batch = body.products.slice(i, i + BATCH_SIZE);
    const rows = batch
      .filter((p) => p && typeof p.product_id_in_feed === "string" && p.product_id_in_feed.length > 0)
      .map((p) => ({
        merchant_id: merchantId,
        product_id_in_feed: p.product_id_in_feed,
        sku: p.sku ?? null,
        name: p.name ?? null,
        description: p.description ?? null,
        brand: p.brand ?? null,
        category: p.category ?? null,
        merchant_category: p.merchant_category ?? null,
        price: p.price ?? null,
        search_price: p.search_price ?? null,
        rrp_price: p.rrp_price ?? null,
        currency: p.currency ?? null,
        in_stock: p.in_stock ?? null,
        product_url: p.product_url ?? null,
        rakuten_deep_link: p.rakuten_deep_link ?? null,
        image_urls: sanitizeImageUrls(p.image_urls),
        lifestyle_image_url: p.lifestyle_image_url ?? null,
        feed_run_id: feedRunId,
        last_seen_at: startedAt,
        removed_at: null,                       // un-tombstone if previously removed
        updated_at: startedAt,
      }));

    totalSkipped += batch.length - rows.length;
    if (rows.length === 0) continue;

    const { error } = await supa
      .from("rakuten_products")
      .upsert(rows, { onConflict: "merchant_id,product_id_in_feed" });
    if (error) {
      errors.push({ batch: i / BATCH_SIZE, error: error.message.slice(0, 300) });
    } else {
      totalUpserted += rows.length;
    }
  }

  // ── 4. Tombstone rows missing from this run (only if full_feed) ──
  let tombstoned = 0;
  const isFull = body.full_feed !== false; // default true
  if (isFull) {
    const { count, error } = await supa
      .from("rakuten_products")
      .update(
        { removed_at: startedAt, updated_at: startedAt },
        { count: "exact" },
      )
      .eq("merchant_id", merchantId!)
      .lt("last_seen_at", startedAt)
      .is("removed_at", null);
    if (error) errors.push({ batch: -1, error: `tombstone: ${error.message.slice(0, 300)}` });
    else tombstoned = count ?? 0;
  }

  // ── 5. Close out the run ──
  await supa
    .from("rakuten_feed_runs")
    .update({
      completed_at: new Date().toISOString(),
      products_inserted: totalUpserted,
      products_tombstoned: tombstoned,
      error_message: errors.length > 0 ? JSON.stringify(errors).slice(0, 1000) : null,
    })
    .eq("id", feedRunId);

  // ── 6. Update merchant-level feed counters ──
  await supa
    .from("rakuten_merchants")
    .update({
      feed_last_synced_at: startedAt,
      feed_last_product_count: totalUpserted,
      feed_last_error: errors.length > 0 ? errors[0].error : null,
      sftp_feed_filename: body.sftp_filename ?? undefined,
      updated_at: startedAt,
    })
    .eq("id", merchantId!);

  return jsonRes({
    ok: errors.length === 0,
    merchant: {
      id: merchantId,
      rakuten_mid: merchantRow?.rakuten_mid,
      name: merchantRow?.merchant_name,
    },
    feed_run_id: feedRunId,
    seen: body.products.length,
    inserted_or_updated: totalUpserted,
    skipped: totalSkipped,
    tombstoned,
    full_feed: isFull,
    errors,
  });
});
