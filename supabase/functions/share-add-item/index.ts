// share-add-item v2 — hand-off endpoint for the iOS "Share → Styled in Motion"
// extension. The extension reads the creator's long-lived device token from the
// shared App Group container and POSTs { url, token }. We resolve the creator
// from the token and insert a pending creator_items row — the exact same
// add-by-URL flow the in-app browser uses, so scrape-product + lookup_catalog_product
// + the affiliate-match suggester all run automatically. No JWT needed (the device
// token is the auth), so it works even when the app is closed / the access token is stale.
// v2: name defaults to '' (creator_items.name is NOT NULL), matching the in-app add flow.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ ok: false, error: "method_not_allowed" }, 405);

  let body: Record<string, string> = {};
  try { body = await req.json(); } catch { /* */ }
  const url = (body.url ?? "").trim();
  const token = (body.token ?? "").trim();
  const name = (body.name ?? "").trim();
  const category = (body.category ?? "Other").trim() || "Other";
  if (!token) return jsonRes({ ok: false, error: "missing_token" }, 400);
  if (!/^https?:\/\//i.test(url)) return jsonRes({ ok: false, error: "invalid_url" }, 400);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Resolve creator from the device token.
  const { data: tok, error: tokErr } = await supa
    .from("share_device_tokens").select("creator_id, revoked_at").eq("token", token).maybeSingle();
  if (tokErr) return jsonRes({ ok: false, error: "token_lookup_failed" }, 500);
  if (!tok || tok.revoked_at) return jsonRes({ ok: false, error: "invalid_token" }, 401);

  // Insert the pending item (same shape as the in-app add-by-URL flow) → triggers scrape-product.
  const { data: item, error: insErr } = await supa
    .from("creator_items")
    .insert({ creator_id: tok.creator_id, url, name, category, fetch_status: "pending" })
    .select("id").single();
  if (insErr) return jsonRes({ ok: false, error: "insert_failed", detail: insErr.message }, 500);

  await supa.from("share_device_tokens").update({ last_used_at: new Date().toISOString() }).eq("token", token);

  return jsonRes({ ok: true, item_id: item.id });
});
