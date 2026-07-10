// awin-creatives-probe — discover which Awin API path serves the My Creative data.
// Tries a list of likely endpoints with our existing publisher token,
// returns status + first ~500 chars of body for each so we can see
// which one returns real data.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AWIN_API_BASE = "https://api.awin.com";

Deno.serve(async () => {
  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: cfg } = await supa.from("awin_publisher_config")
    .select("publisher_id, api_token").eq("id", 1).maybeSingle();
  if (!cfg?.api_token) {
    return new Response(JSON.stringify({ error: "no_token" }), { status: 500 });
  }
  const pid = cfg.publisher_id;
  const headers = {
    "Authorization": `Bearer ${cfg.api_token}`,
    "Accept": "application/json",
  };

  // Pick one merchant we know has creatives in the dashboard (Bolsa Nova)
  const advId = "119569";

  const candidates = [
    `${AWIN_API_BASE}/publishers/${pid}/creatives`,
    `${AWIN_API_BASE}/publishers/${pid}/banners`,
    `${AWIN_API_BASE}/publishers/${pid}/creative`,
    `${AWIN_API_BASE}/publishers/${pid}/programmes/${advId}/creatives`,
    `${AWIN_API_BASE}/publishers/${pid}/programmes/${advId}/banners`,
    `${AWIN_API_BASE}/publishers/${pid}/creativecode`,
    `${AWIN_API_BASE}/publishers/${pid}/creativeassets`,
    `${AWIN_API_BASE}/publishers/${pid}/links`,
    `${AWIN_API_BASE}/publishers/${pid}/advertisers/${advId}/creatives`,
    `${AWIN_API_BASE}/publishers/${pid}/advertiser/${advId}/creatives`,
    `${AWIN_API_BASE}/publishers/${pid}/marketing-content`,
    `${AWIN_API_BASE}/publishers/${pid}/mycreative`,
  ];

  const results: any[] = [];
  for (const url of candidates) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      const text = await r.text();
      results.push({
        url,
        status: r.status,
        content_type: r.headers.get("content-type") ?? null,
        body: text.slice(0, 400),
      });
    } catch (e) {
      results.push({ url, error: (e as Error).message });
    }
    await new Promise((r) => setTimeout(r, 200)); // throttle
  }

  return new Response(JSON.stringify({ publisher_id: pid, advertiser_id: advId, results }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
