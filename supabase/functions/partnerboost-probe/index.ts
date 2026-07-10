// partnerboost-probe — diagnostic. POSTs to a PartnerBoost API URL with the
// secret PARTNERBOOST_API_TOKEN injected, returns the raw response. Host-
// restricted to *.partnerboost.com so the token can't be exfiltrated to an
// arbitrary host. Keep for tuning new endpoints (datafeed, ACC, monetization).
// POST body: { url: "<full PB api url>", body?: {extra params} }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const PB_TOKEN = Deno.env.get("PARTNERBOOST_API_TOKEN") ?? "";
const ALLOWED = /(^|\.)partnerboost\.com$/i;
function j(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } }); }
Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ error: "method_not_allowed" }, 405);
  if (!PB_TOKEN) return j({ error: "no_PARTNERBOOST_API_TOKEN" }, 500);
  let b: any = {};
  try { b = await req.json(); } catch { /* */ }
  const url = String(b.url ?? "");
  let host = "";
  try { host = new URL(url).hostname; } catch { return j({ error: "bad_url" }, 400); }
  if (!ALLOWED.test(host)) return j({ error: "host_not_allowed", host }, 400);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: PB_TOKEN, ...(b.body ?? {}) }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    return j({ status: res.status, ms: Date.now() - t0, body: text.slice(0, 6000) });
  } catch (e) {
    return j({ error: (e as Error).message, ms: Date.now() - t0 });
  }
});
