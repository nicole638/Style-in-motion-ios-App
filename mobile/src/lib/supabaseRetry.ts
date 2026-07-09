// Shared transient-retry wrapper for user-initiated Supabase writes.
//
// PostgREST returns transient errors while its schema cache is reloading
// (PGRST002 — "Could not query the database for the schema cache. Retrying.",
// which fires after ANY DDL/migration) or when the DB connection blips
// (08xxx / 57P01). These self-heal in a second or two, so a single write that
// lands in that window shouldn't surface as a hard failure and silently lose
// the user's work. We retry a few times with linear backoff on those codes
// ONLY — real errors (RLS, CHECK/FK violations, 23505 duplicate key) return
// immediately, unchanged.
//
// HARD REQUIREMENT — idempotency: only wrap writes that are safe to repeat
// (an upsert, or an insert with a stable client-supplied dedup key). If a write
// actually succeeded but its ack was lost (the exact transient case), the retry
// must not create a duplicate row. Reads don't need this (just re-fetch), and
// fire-and-forget / analytics writes shouldn't use it (a dropped one isn't
// user-visible work).

// Transient allowlist. Everything else is treated as a real error.
export const TRANSIENT_PG_CODES = new Set<string>([
  'PGRST002', // schema cache not loaded yet ("Could not query ... Retrying.")
  'PGRST001', // could not connect to the database
  '08000',
  '08003',
  '08006', // connection exceptions
  '57P01', // admin shutdown / connection terminated
]);

/**
 * Run a Supabase write thunk, retrying on transient PostgREST/connection errors
 * only. Caps at `tries` attempts with linear backoff (default 400ms → 800ms);
 * a PGRST002 that persists past a few seconds is an infra outage (origin down),
 * not a reload, so the cap correctly stops us from hammering it.
 *
 * Accepts a thunk returning the Supabase builder (a PromiseLike with a `{ data,
 * error }` result) so the full response type — including `data` — is preserved.
 */
export async function withTransientRetry<T extends { error: unknown }>(
  run: () => PromiseLike<T>,
  tries = 3,
  baseDelayMs = 400,
): Promise<T> {
  let result = await run();
  for (let attempt = 1; attempt < tries; attempt++) {
    const code = (result.error as { code?: string } | null)?.code;
    if (!result.error || !code || !TRANSIENT_PG_CODES.has(code)) return result;
    await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
    result = await run();
  }
  return result;
}
