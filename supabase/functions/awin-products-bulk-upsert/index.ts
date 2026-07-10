// awin-products-bulk-upsert — DECOMMISSIONED.
//
// This EF is a one-shot bootstrap for seeding awin_products from a
// pre-parsed JSON product array, used when we have a feed file locally
// but no public Darwin URL yet. Activated 2026-05-19 for Elastique
// (68948, 335 products), reactivated 2026-05-20 for Forme (102755, 809
// products), then re-decommissioned. To reuse: redeploy with the
// bootstrap secret + verify_jwt=false, POST { merchant_id, rows }, then
// flip back to this 410 stub.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(
  JSON.stringify({ error: "gone", detail: "This bootstrap loader is decommissioned." }),
  { status: 410, headers: { "Content-Type": "application/json" } },
));
