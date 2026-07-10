// pinterest-oauth-exchange v4 — completes the OAuth flow.
//
// Called by iOS/web after Pinterest redirects back with ?code=&state=
// Validates the state token against creator_pinterest_oauth_states, exchanges
// the auth code with Pinterest's token endpoint, then writes:
//   - creator_pinterest_tokens row with the access + refresh tokens
//   - creator_profiles.pinterest_handle + pinterest_enabled (existing fields)
//
// Returns the connected Pinterest username so the UI can show "Connected as
// @username" immediately without a separate fetch.
//
// v4 (2026-06-10): added continuous_refresh=true per Pinterest's official
// OAuth spec. Without it, refresh tokens expire annually and creators have
// to reconnect. With it, refresh tokens are non-expiring.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PINTEREST_APP_ID = Deno.env.get("PINTEREST_APP_ID") ?? "1572494";
const PINTEREST_APP_SECRET = Deno.env.get("PINTEREST_APP_SECRET") ?? "";

const PROD_API_BASE = "https://api.pinterest.com/v5";
const SANDBOX_API_BASE = "https://api-sandbox.pinterest.com/v5";

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

  if (!PINTEREST_APP_SECRET) {
    return jsonRes({ error: "PINTEREST_APP_SECRET env var not set" }, 500);
  }

  // Authenticate caller via JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return jsonRes({ error: "missing_auth" }, 401);
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return jsonRes({ error: "invalid_jwt" }, 401);
  const creatorId = user.id;

  let body: { code?: string; state?: string };
  try { body = await req.json(); }
  catch { return jsonRes({ error: "bad_json" }, 400); }
  const code = body.code?.trim();
  const state = body.state?.trim();
  if (!code || !state) return jsonRes({ error: "missing_code_or_state" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Validate + consume state token
  const { data: stateRow, error: stateErr } = await admin
    .from("creator_pinterest_oauth_states")
    .select("creator_id, redirect_uri, scopes_requested, api_environment, consumed_at, created_at")
    .eq("state_token", state)
    .maybeSingle();

  if (stateErr || !stateRow) return jsonRes({ error: "invalid_state" }, 400);
  if (stateRow.consumed_at) return jsonRes({ error: "state_already_used" }, 400);
  if (stateRow.creator_id !== creatorId) return jsonRes({ error: "state_creator_mismatch" }, 403);

  const ageMs = Date.now() - new Date(stateRow.created_at).getTime();
  if (ageMs > 10 * 60 * 1000) return jsonRes({ error: "state_expired" }, 400);

  // Mark consumed (race-safe: only succeeds if consumed_at is still null)
  const { error: consumeErr } = await admin
    .from("creator_pinterest_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("state_token", state)
    .is("consumed_at", null);
  if (consumeErr) return jsonRes({ error: "state_consume_failed", detail: consumeErr.message }, 500);

  const apiBase = stateRow.api_environment === "sandbox" ? SANDBOX_API_BASE : PROD_API_BASE;

  // Exchange auth code for tokens
  const basicAuth = btoa(`${PINTEREST_APP_ID}:${PINTEREST_APP_SECRET}`);
  const formBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: stateRow.redirect_uri,
    // v4: ask Pinterest for a non-expiring refresh token per their official
    // OAuth spec (otherwise refresh tokens expire annually).
    continuous_refresh: "true",
  });

  let tokenJson: any;
  try {
    const r = await fetch(`${apiBase}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: formBody.toString(),
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    if (!r.ok) {
      return jsonRes({ error: `pinterest_token_${r.status}`, detail: text.slice(0, 400) }, 502);
    }
    tokenJson = JSON.parse(text);
  } catch (e) {
    return jsonRes({ error: "pinterest_token_failed", detail: (e as Error).message }, 502);
  }

  const accessToken: string | undefined = tokenJson.access_token;
  const refreshToken: string | undefined = tokenJson.refresh_token;
  const expiresIn: number | undefined = tokenJson.expires_in;
  const scopeRaw: string | undefined = tokenJson.scope;
  if (!accessToken) {
    return jsonRes({ error: "no_access_token_in_response", detail: JSON.stringify(tokenJson).slice(0, 300) }, 502);
  }

  // Fetch user account to capture username + id
  let pinterestUserId: string | null = null;
  let pinterestUsername: string | null = null;
  try {
    const r = await fetch(`${apiBase}/user_account`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) {
      const j = await r.json();
      pinterestUserId = j.id ?? null;
      pinterestUsername = j.username ?? null;
    }
  } catch { /* non-fatal; we still have the token */ }

  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  const scopes = scopeRaw ? scopeRaw.split(/[,\s]+/).filter((s) => s.length > 0) : (stateRow.scopes_requested ?? []);

  const { error: tokenInsertErr } = await admin
    .from("creator_pinterest_tokens")
    .upsert({
      creator_id: creatorId,
      access_token: accessToken,
      refresh_token: refreshToken ?? null,
      scopes,
      expires_at: expiresAt,
      pinterest_user_id: pinterestUserId,
      pinterest_username: pinterestUsername,
      api_environment: stateRow.api_environment,
      connected_at: new Date().toISOString(),
      refreshed_at: null,
      revoked_at: null,
    });
  if (tokenInsertErr) return jsonRes({ error: "token_store_failed", detail: tokenInsertErr.message }, 500);

  // Update creator_profiles to mirror the existing pinterest_handle / enabled
  // convention so other surfaces (web bio links, etc.) light up.
  if (pinterestUsername) {
    await admin
      .from("creator_profiles")
      .update({
        pinterest_handle: pinterestUsername,
        pinterest_enabled: true,
      })
      .eq("creator_id", creatorId);
  } else {
    await admin
      .from("creator_profiles")
      .update({ pinterest_enabled: true })
      .eq("creator_id", creatorId);
  }

  return jsonRes({
    ok: true,
    pinterest_user_id: pinterestUserId,
    pinterest_username: pinterestUsername,
    scopes,
    expires_at: expiresAt,
    environment: stateRow.api_environment,
  });
});
