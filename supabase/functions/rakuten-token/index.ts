// rakuten-token EF
// Single source of truth for a valid Rakuten access_token.
// Reads rakuten_publisher_config (by sid query param, or the row with is_default=true).
// Returns the cached token if it has >60s of life left; otherwise refreshes via /token and
// persists the new access_token/refresh_token/expires_at back to the row.
//
// Auth: verify_jwt=true. Other EFs call this with the service-role JWT.
//
// Endpoints:
//   GET  ?sid=<sid>             -> token for a specific SID
//   GET  ?force=1               -> bypass cache, force a refresh
//   POST { "sid": "..." }       -> same as GET ?sid=...
//
// Response: { access_token, sid, expires_at, seconds_remaining, source }
//   source: 'cache' | 'refresh' | 'fresh'

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RAKUTEN_TOKEN_ENDPOINT = "https://api.linksynergy.com/token";
const CACHE_SKEW_MS = 60_000;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface ConfigRow {
  sid: string;
  name: string;
  client_id: string;
  client_secret: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  refresh_token: string | null;
  is_default: boolean;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

async function callTokenEndpoint(tokenKey: string, body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(RAKUTEN_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${tokenKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`status=${res.status} body=${text}`);
  }
  return await res.json() as TokenResponse;
}

async function fetchFreshToken(
  cfg: ConfigRow,
): Promise<{ tok: TokenResponse; source: "refresh" | "fresh" }> {
  const tokenKey = btoa(`${cfg.client_id}:${cfg.client_secret}`);

  // 1) Try refresh_token if we have one.
  if (cfg.refresh_token) {
    try {
      const tok = await callTokenEndpoint(
        tokenKey,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: cfg.refresh_token,
          scope: cfg.sid,
        }),
      );
      return { tok, source: "refresh" };
    } catch (e) {
      console.log(`rakuten-token: refresh failed for sid=${cfg.sid}, falling back to fresh. detail=${String(e)}`);
    }
  }

  // 2) Fresh client-cred-equivalent fetch (scope only, per Rakuten docs).
  const tok = await callTokenEndpoint(
    tokenKey,
    new URLSearchParams({ scope: cfg.sid }),
  );
  return { tok, source: "fresh" };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Resolve which SID the caller wants.
  const url = new URL(req.url);
  let requestedSid = url.searchParams.get("sid");
  const force = url.searchParams.get("force") === "1";
  if (!requestedSid && req.method === "POST") {
    try {
      const body = await req.json();
      requestedSid = (body && typeof body.sid === "string") ? body.sid : null;
    } catch {
      // ignore — JSON body is optional
    }
  }

  // Look up the config row.
  let q = supabase.from("rakuten_publisher_config").select("*");
  if (requestedSid) {
    q = q.eq("sid", requestedSid);
  } else {
    q = q.eq("is_default", true);
  }
  const { data: cfg, error: cfgErr } = await q.maybeSingle();
  if (cfgErr) {
    return new Response(
      JSON.stringify({ error: "config lookup failed", detail: cfgErr.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!cfg) {
    return new Response(
      JSON.stringify({ error: "no rakuten_publisher_config row", requestedSid }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  // Cache hit?
  const now = Date.now();
  const expiresAt = cfg.access_token_expires_at
    ? new Date(cfg.access_token_expires_at).getTime()
    : 0;
  if (!force && cfg.access_token && expiresAt - now > CACHE_SKEW_MS) {
    return new Response(
      JSON.stringify({
        access_token: cfg.access_token,
        sid: cfg.sid,
        expires_at: cfg.access_token_expires_at,
        seconds_remaining: Math.round((expiresAt - now) / 1000),
        source: "cache",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Need a fresh token.
  let tokResult: { tok: TokenResponse; source: "refresh" | "fresh" };
  try {
    tokResult = await fetchFreshToken(cfg as ConfigRow);
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "token fetch failed",
        detail: String(e),
        sid: cfg.sid,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  const newExpiresAt = new Date(now + tokResult.tok.expires_in * 1000).toISOString();
  const { error: updErr } = await supabase
    .from("rakuten_publisher_config")
    .update({
      access_token: tokResult.tok.access_token,
      access_token_expires_at: newExpiresAt,
      refresh_token: tokResult.tok.refresh_token,
      updated_at: new Date().toISOString(),
    })
    .eq("sid", cfg.sid);
  if (updErr) {
    console.error(`rakuten-token: failed to persist new token for sid=${cfg.sid}`, updErr);
  }

  return new Response(
    JSON.stringify({
      access_token: tokResult.tok.access_token,
      sid: cfg.sid,
      expires_at: newExpiresAt,
      seconds_remaining: tokResult.tok.expires_in,
      source: tokResult.source,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
