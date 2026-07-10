// pinterest-oauth-revoke — disconnect a creator's Pinterest. Soft-revokes
// (revoked_at timestamp) so we keep an audit trail, but the access_token
// gets nulled out so it can't be used. Also flips pinterest_enabled=false
// on creator_profiles.

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
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonRes({ error: "missing_auth" }, 401);
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return jsonRes({ error: "invalid_jwt" }, 401);
  const creatorId = user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  await admin.from("creator_pinterest_tokens")
    .update({
      access_token: "",
      refresh_token: null,
      revoked_at: new Date().toISOString(),
    })
    .eq("creator_id", creatorId);

  await admin.from("creator_profiles")
    .update({ pinterest_enabled: false })
    .eq("creator_id", creatorId);

  return jsonRes({ ok: true });
});
