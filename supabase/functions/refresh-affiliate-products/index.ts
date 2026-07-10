// refresh-affiliate-products — one-shot wrapper around REFRESH MATERIALIZED VIEW
// for the affiliate_products matview. Exists because the MCP SQL endpoint has
// a short statement timeout that kills refresh-in-progress for the full 280K
// row materialized view. EFs get 60+s wall time which fits.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const concurrent = body.concurrent !== false; // default true so reads don't block
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const sql = concurrent
    ? "REFRESH MATERIALIZED VIEW CONCURRENTLY affiliate_products"
    : "REFRESH MATERIALIZED VIEW affiliate_products";
  try {
    // Use a raw query via the postgres-meta-style RPC. supabase-js v2 doesn't
    // expose raw SQL through the JS client — but we can call a SECURITY DEFINER
    // RPC if one exists. Simpler: hit PostgREST's /rest/v1/rpc with a tiny
    // helper function. Fall back to constructing the URL directly.
    const url = `${SUPABASE_URL}/rest/v1/rpc/refresh_affiliate_products`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "apikey": SERVICE_ROLE,
        "Authorization": `Bearer ${SERVICE_ROLE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ concurrent }),
      signal: AbortSignal.timeout(120000),
    });
    const text = await res.text();
    const elapsed = Date.now() - t0;
    return new Response(
      JSON.stringify({ ok: res.ok, status: res.status, elapsed_ms: elapsed, response: text.slice(0, 500), sql, used_rpc: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message, elapsed_ms: Date.now() - t0, sql }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
