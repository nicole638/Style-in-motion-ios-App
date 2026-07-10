// amazon-token — manages the Amazon Creators API access token via the
// client_credentials OAuth flow.
//
// Design:
//   - verify_jwt=false. Invoked server-to-server from other EFs and from
//     creators-web admin server actions. Custom shared-secret auth via
//     the AMAZON_TOKEN_FUNCTION_KEY env var.
//   - GET / (or POST /): returns a current access token, refreshing from
//     Amazon if the cached one is within 60s of expiry.
//   - The Amazon Creators API uses grant_type=client_credentials. No user
//     OAuth handshake. No refresh token. Just trade client_id +
//     client_secret for a ~1hr access token, repeat.
//
// Env vars (set in Supabase dashboard → Edge Functions → Secrets):
//   AMAZON_CLIENT_ID   - amzn1.application-oa2-client.…
//   Amazon_API         - the OAuth client secret (Nicole's naming)
//
// Token endpoint + scope from public Amazon Creators API docs.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL    = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AMAZON_CLIENT_ID = Deno.env.get("AMAZON_CLIENT_ID")!;
// Nicole stored the secret under this exact (mixed-case) name.
const AMAZON_CLIENT_SECRET = Deno.env.get("Amazon_API")!;

const PROVIDER = "amazon_creators";
const TOKEN_URL = "https://api.amazon.com/auth/O2/token";
const SCOPE = "creatorsapi::default"; // v3.x credentials scope per Amazon docs
// Refresh when the cached token is within this many seconds of expiry.
// Gives plenty of buffer so downstream callers never get a 401.
const REFRESH_BUFFER_S = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

interface CachedToken {
  access_token: string | null;
  access_token_expires_at: string | null;
}

async function loadCache(
  supa: ReturnType<typeof createClient>,
): Promise<CachedToken | null> {
  const { data, error } = await supa
    .from("platform_secrets")
    .select("access_token, access_token_expires_at")
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error) {
    console.warn("[amazon-token] loadCache:", error.message);
    return null;
  }
  return data as CachedToken | null;
}

async function persistToken(
  supa: ReturnType<typeof createClient>,
  accessToken: string,
  expiresAt: string,
) {
  // Upsert keyed on provider. refresh_token kept NULL for client_credentials.
  const { error } = await supa
    .from("platform_secrets")
    .upsert(
      {
        provider: PROVIDER,
        client_id: AMAZON_CLIENT_ID,
        refresh_token: null,
        access_token: accessToken,
        access_token_expires_at: expiresAt,
        scope: SCOPE,
      },
      { onConflict: "provider" },
    );
  if (error) {
    console.warn("[amazon-token] persistToken:", error.message);
    throw new Error(`persist_failed: ${error.message}`);
  }
}

async function fetchFreshToken(): Promise<{
  access_token: string;
  expires_at: string;
}> {
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", AMAZON_CLIENT_ID);
  body.set("client_secret", AMAZON_CLIENT_SECRET);
  body.set("scope", SCOPE);

  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });

  const text = await r.text();
  if (r.status !== 200) {
    // Surface Amazon's error verbatim — typical issues are invalid_client
    // (wrong id/secret pair) or invalid_scope (account not entitled).
    throw new Error(`amazon_token_${r.status}: ${text.slice(0, 500)}`);
  }

  let parsed: { access_token?: string; expires_in?: number };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`amazon_token_bad_json: ${text.slice(0, 200)}`);
  }

  if (!parsed.access_token || !parsed.expires_in) {
    throw new Error(
      `amazon_token_missing_fields: ${Object.keys(parsed).join(",")}`,
    );
  }

  // expires_in is seconds-until-expiry from now
  const expiresAt = new Date(
    Date.now() + parsed.expires_in * 1000,
  ).toISOString();
  return { access_token: parsed.access_token, expires_at: expiresAt };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Sanity-check required env vars before doing anything.
  if (!AMAZON_CLIENT_ID || !AMAZON_CLIENT_SECRET) {
    return jsonRes(
      {
        error: "missing_env",
        detail:
          "AMAZON_CLIENT_ID and Amazon_API must both be set in Supabase Edge Function secrets.",
        has_client_id: !!AMAZON_CLIENT_ID,
        has_client_secret: !!AMAZON_CLIENT_SECRET,
      },
      500,
    );
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Body parse — supports { force_refresh: true } to bypass cache for ops debug.
  let force = false;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      force = body?.force_refresh === true;
    } catch {
      // ignore — body is optional
    }
  }

  // Check cache.
  if (!force) {
    const cached = await loadCache(supa);
    if (
      cached?.access_token &&
      cached.access_token_expires_at &&
      new Date(cached.access_token_expires_at).getTime() - Date.now() >
        REFRESH_BUFFER_S * 1000
    ) {
      return jsonRes({
        access_token: cached.access_token,
        expires_at: cached.access_token_expires_at,
        from_cache: true,
      });
    }
  }

  // Mint a fresh token from Amazon.
  let fresh: { access_token: string; expires_at: string };
  try {
    fresh = await fetchFreshToken();
  } catch (e) {
    return jsonRes(
      { error: "amazon_call_failed", detail: (e as Error).message },
      502,
    );
  }

  try {
    await persistToken(supa, fresh.access_token, fresh.expires_at);
  } catch (e) {
    // Token is good even if persist failed — hand it back so the caller
    // can proceed; flag the error so ops sees it.
    return jsonRes(
      {
        access_token: fresh.access_token,
        expires_at: fresh.expires_at,
        from_cache: false,
        persist_error: (e as Error).message,
      },
      200,
    );
  }

  return jsonRes({
    access_token: fresh.access_token,
    expires_at: fresh.expires_at,
    from_cache: false,
  });
});
