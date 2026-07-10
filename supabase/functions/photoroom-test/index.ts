// photoroom-test — RETIRED 2026-06-23.
// Temporary diagnostic harness that proved Photoroom's Ghost Mannequin handles
// black garments fine and that the segmentation pre-step caused the black-bottom
// blob. Finding shipped in cutout-item-photo v24 (bottoms → ghost-direct).
// phtest/ images cleaned up. Body neutralized — safe to delete from dashboard.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
Deno.serve(() =>
  new Response(
    JSON.stringify({ error: "gone", detail: "photoroom-test was a temporary diagnostic harness and has been retired." }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
