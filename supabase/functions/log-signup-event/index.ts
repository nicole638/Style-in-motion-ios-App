import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "content-type": "application/json" } });

const EVENTS = new Set(["page_view", "attempt", "success", "error"]);
const SURFACES = new Set(["creator", "audience", "unknown"]);
const clip = (v: unknown, n: number) => (v == null ? null : String(v).slice(0, n));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* tolerate empty/bad body */ }

  const event = String(body.event ?? "").trim();
  if (!EVENTS.has(event)) return json({ error: "bad_event" }, 400);

  let surface = String(body.surface ?? "unknown").toLowerCase();
  if (!SURFACES.has(surface)) surface = "unknown";

  const ua = req.headers.get("user-agent") ?? "";
  const row = {
    event,
    surface,
    user_type: clip(body.user_type, 40),
    email: clip(body.email, 200),
    error_code: clip(body.error_code ?? body.error, 300),
    source: clip(body.source, 20) ?? (/(iphone|ipad|ios)/i.test(ua) ? "ios" : "web"),
    session_id: clip(body.session_id, 100),
    user_agent: clip(ua, 400),
    referer: clip(req.headers.get("referer") ?? req.headers.get("referrer"), 400),
  };

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { error } = await supabase.from("signup_funnel_events").insert(row);
    if (error) return json({ error: error.message }, 500);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
  return json({ ok: true });
});
