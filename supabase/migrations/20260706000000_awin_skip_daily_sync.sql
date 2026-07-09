-- awin_merchants.skip_daily_sync — gates WHICH Awin product feeds are ingested
-- by the Hono backend (backend/src/lib/awinFeedSync.ts) instead of the
-- `awin-feeds-sync` Supabase edge function.
--
-- WHY: some Awin feeds are too large for the Deno edge runtime — Under Armour
-- US is a 4.3MB gzip that inflates to ~72MB / ~45k rows and OOMs the edge
-- function when decompressing. Node's zlib.gunzipSync handles the multi-member
-- gzip fine, so those oversized feeds are delegated to the backend.
--
-- When true: the daily edge-function sync SKIPS this merchant, and the Hono
-- job (POST /api/awin-sync/run, or syncAwinFeeds() with no merchantIds) picks
-- it up instead. The edge function itself is UNCHANGED by this work — it will
-- simply learn to honor this flag; every merchant with skip_daily_sync = false
-- (the default) continues to sync via the edge function exactly as before.
--
-- Idempotent: safe to re-run. Applied to prod separately; mirrored here for VCS.

alter table public.awin_merchants
  add column if not exists skip_daily_sync boolean not null default false;

-- Under Armour US — the first oversized feed handed off to the backend.
update public.awin_merchants
  set skip_daily_sync = true
  where id = '66ab5d26-39e0-46dd-8837-ebfe2945ef46';
