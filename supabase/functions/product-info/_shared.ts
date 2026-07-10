// _shared.ts — env + service-role client shim for the product-info edge
// function (Vibecode migration, 2026-07-09). Replaces the legacy backend's
// `../env` (Zod-validated process.env) and `./supabase` modules with the
// edge-runtime equivalents, keeping the SAME exported names so the ported
// route/libs keep their `env.X` / `getSupabaseAdmin()` call sites verbatim.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const env = {
  SUPABASE_URL: Deno.env.get("SUPABASE_URL") ?? "",
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  SCRAPINGBEE_API_KEY: Deno.env.get("SCRAPINGBEE_API_KEY") ?? "",
};

let _admin: SupabaseClient | null = null;
export function getSupabaseAdmin(): SupabaseClient | null {
  if (_admin) return _admin;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  _admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return _admin;
}

/** sha256 hex via WebCrypto — replaces node:crypto createHash. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
