// pinterest-oauth-init — generates the Pinterest OAuth authorize URL for a
// signed-in creator. Caller (iOS/web) opens this URL in a browser/webview.
//
// Flow:
//   1. iOS app: invoke this EF → receives { auth_url, state_token }
//   2. App opens auth_url in webview (or external Safari)
//   3. User signs into Pinterest, approves scopes
//   4. Pinterest redirects to our registered callback with ?code=&state=
//   5. iOS captures the redirect URL, extracts code+state, calls
//      pinterest-oauth-exchange to complete
//
// verify_jwt=true so we know which creator is connecting (from the JWT).
//
// v2 (June 2026): DEFAULT_SCOPES now include boards:write + pins:write —
// required for in-app "Pin to Pinterest" (and the Pinterest Standard-access
// review, which requires demonstrating Pin creation from the app).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PINTEREST_APP_ID = Deno.env.get("PINTEREST_APP_ID") ?? "1572494";

// Default redirect URI registered in the Pinterest app config. Must match
// EXACTLY what's registered at developers.pinterest.com/apps/1572494
const DEFAULT_REDIRECT_URI = Deno.env.get("PINTEREST_REDIRECT_URI")
  ?? "https://shop.styledinmotion.studio/api/pinterest/callback";

// Sandbox vs Production base for the AUTHORIZE step. Note: even when using
// sandbox tokens for the API itself, OAuth always happens via the
// pinterest.com domain (sandbox uses the same authorize endpoint).
const PINTEREST_AUTH_BASE = "https://www.pinterest.com";

// Read scopes for board import + write scopes for in-app pinning.
const DEFAULT_SCOPES = [
  "user_accounts:read",
  "boards:read",
  "pins:read",
  "boards:write",
  "pins:write",
];

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

function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonRes({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonRes({ error: "missing_auth" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return jsonRes({ error: "invalid_jwt", detail: userErr?.message }, 401);

  const creatorId = user.id;

  let body: { scopes?: string[]; redirect_uri?: string; environment?: "production" | "sandbox" } = {};
  try { body = await req.json(); } catch { /* */ }

  const scopes = (body.scopes && body.scopes.length > 0) ? body.scopes : DEFAULT_SCOPES;
  const redirectUri = body.redirect_uri ?? DEFAULT_REDIRECT_URI;
  const environment = body.environment === "sandbox" ? "sandbox" : "production";

  const stateToken = randomState();
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { error: insertErr } = await adminClient
    .from("creator_pinterest_oauth_states")
    .insert({
      state_token: stateToken,
      creator_id: creatorId,
      redirect_uri: redirectUri,
      scopes_requested: scopes,
      api_environment: environment,
    });
  if (insertErr) return jsonRes({ error: "state_insert_failed", detail: insertErr.message }, 500);

  const authUrl = new URL(`${PINTEREST_AUTH_BASE}/oauth/`);
  authUrl.searchParams.set("client_id", PINTEREST_APP_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scopes.join(","));
  authUrl.searchParams.set("state", stateToken);

  return jsonRes({
    ok: true,
    auth_url: authUrl.toString(),
    state_token: stateToken,
    scopes,
    environment,
  });
});
