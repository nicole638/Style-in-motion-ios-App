-- ────────────────────────────────────────────────────────────────────────────
-- Awin ingest — dedicated "full catalog via Hono backend" opt-in flag.
--
-- Context: oversized Awin feeds (Under Armour ~45k, Zeagoo ~88k, Punk Design
-- ~26k, LA Apparel ~17k) all carry `awin_merchants.skip_daily_sync = true` so
-- the Supabase edge function `awin-feeds-sync` leaves them alone (it OOMs on
-- them). But `skip_daily_sync` is NOT a safe selector for the Hono ingest:
-- Zeagoo / Punk / LA Apparel are intentionally kept partial/deduped and must
-- NOT have their full catalogs pulled.
--
-- So which feeds the Hono backend (lib/awinFeedSync.ts → POST /api/awin-sync/run)
-- fully ingests is a SEPARATE opt-in flag: `hono_full_ingest`. Only Under Armour
-- is enabled for now. The bodyless "sweep" path of syncAwinFeeds() keys off this
-- flag; the pg_cron job passes an explicit `merchant_id` and doesn't rely on it.
--
-- The edge function `awin-feeds-sync` is unchanged by this migration.
--
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.awin_merchants
  add column if not exists hono_full_ingest boolean not null default false;

-- Enable full Hono ingest for Under Armour US ONLY.
update public.awin_merchants
  set hono_full_ingest = true
  where id = '66ab5d26-39e0-46dd-8837-ebfe2945ef46';
