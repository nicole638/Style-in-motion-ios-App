// awin-import-products-once v6 — one-shot bulk import for manually-uploaded feed.
// Accepts {merchant_id, products: [...], skip_tombstone?: boolean}
// where products match awin_products schema.
// Used to bootstrap merchants whose feeds aren't fetchable via HTTPS (e.g. Under Armour).
//
// v6 adds skip_tombstone flag for chunked uploads — caller does a final SQL
// tombstone pass after all chunks land.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({error: "method"}), {status: 405});
  let body: any;
  try { body = await req.json(); }
  catch (e) { return new Response(JSON.stringify({error: "bad_json", detail: String(e)}), {status: 400}); }

  const merchantId: string | undefined = body.merchant_id;
  const products: any[] = Array.isArray(body.products) ? body.products : [];
  const skipTombstone = body.skip_tombstone === true;
  if (!merchantId) return new Response(JSON.stringify({error: "missing_merchant_id"}), {status: 400});
  if (products.length === 0) return new Response(JSON.stringify({error: "no_products"}), {status: 400});

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const startedAt = new Date();

  const { data: run } = await supa.from("awin_feed_runs").insert({
    merchant_id: merchantId,
    feed_url: skipTombstone ? "manual_upload_chunk" : "manual_upload",
    started_at: startedAt.toISOString(),
  }).select("id").single();
  const runId = run?.id ?? null;

  const BATCH = 200;
  let inserted = 0;
  let err: string | null = null;
  for (let i = 0; i < products.length; i += BATCH) {
    const slice = products.slice(i, i + BATCH).map((p) => ({
      ...p,
      merchant_id: merchantId,
      feed_run_id: runId,
      last_seen_at: startedAt.toISOString(),
      removed_at: null,
      updated_at: startedAt.toISOString(),
    }));
    const { error: e } = await supa.from("awin_products")
      .upsert(slice, { onConflict: "merchant_id,product_id_in_feed" });
    if (e) { err = e.message; break; }
    inserted += slice.length;
  }

  let tombstoned = 0;
  if (!err && inserted > 0 && !skipTombstone) {
    const { count } = await supa.from("awin_products")
      .update({ removed_at: new Date().toISOString() }, { count: "exact" })
      .eq("merchant_id", merchantId)
      .is("removed_at", null)
      .lt("last_seen_at", startedAt.toISOString());
    tombstoned = count ?? 0;
  }

  if (runId) {
    await supa.from("awin_feed_runs").update({
      completed_at: new Date().toISOString(),
      http_status: 200,
      products_seen: inserted,
      products_updated: inserted,
      products_tombstoned: tombstoned,
      error_message: err,
    }).eq("id", runId);
  }

  await supa.from("awin_merchants").update({
    feed_last_synced_at: new Date().toISOString(),
    feed_last_product_count: inserted,
    feed_last_error: err,
  }).eq("id", merchantId);

  return new Response(JSON.stringify({
    ok: !err, error: err, inserted, tombstoned, run_id: runId, skip_tombstone: skipTombstone,
  }), { status: 200, headers: { "Content-Type": "application/json" }});
});
