import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "../env";

let _admin: SupabaseClient | null = null;

/**
 * Lazy service-role client. Returns null when SUPABASE_URL or
 * SUPABASE_SERVICE_ROLE_KEY isn't set so callers can fall back gracefully
 * instead of crashing the server at boot. Service-role bypasses RLS — never
 * expose this client to user-controlled input paths.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (_admin) return _admin;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  _admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return _admin;
}
