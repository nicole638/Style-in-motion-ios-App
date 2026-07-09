-- ────────────────────────────────────────────────────────────────────────────
-- share_beacon — reshape to match the table rebuilt in Supabase for build 5.2.
--
-- The original 20260709030000_share_beacon.sql used side ('app'|'ext'), `suite`,
-- and split `app_version`/`build_number`. The live table was reshaped to the
-- column set both beacons now write:
--   side ('app_write' | 'extension_read'), creator_id, module_present,
--   write_returned, container_reachable, token_found, app_group, build, note.
--
-- This migration brings the repo in line with that live table so `supabase
-- db diff` stays empty (schema discipline) and a rebuild-from-migrations accepts
-- the inserts. Idempotent: safe to re-run. RLS / grants from the original
-- migration are unchanged and intentionally not re-declared here.
-- ────────────────────────────────────────────────────────────────────────────

-- Rename columns (guarded so a fresh/live table already in the new shape is a
-- no-op — Postgres has no RENAME COLUMN IF EXISTS).
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'share_beacon'
               and column_name = 'suite') then
    alter table public.share_beacon rename column suite to app_group;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'share_beacon'
               and column_name = 'app_version') then
    alter table public.share_beacon rename column app_version to build;
  end if;
end $$;

-- Fold the old build_number into `build` where present, then drop the extras.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'share_beacon'
               and column_name = 'build_number') then
    update public.share_beacon
      set build = coalesce(build, '') ||
                  case when build_number is not null and build_number <> ''
                       then ' (' || build_number || ')' else '' end
      where build_number is not null;
  end if;
end $$;

alter table public.share_beacon drop column if exists build_number;
alter table public.share_beacon drop column if exists extra;

-- New column: which creator the write belonged to (nullable; the extension
-- can't resolve it, and the app write path doesn't require it).
alter table public.share_beacon add column if not exists creator_id uuid;

-- Migrate the discriminator values, then swap the CHECK constraint.
update public.share_beacon set side = 'app_write'      where side = 'app';
update public.share_beacon set side = 'extension_read' where side = 'ext';

alter table public.share_beacon drop constraint if exists share_beacon_side_check;
alter table public.share_beacon
  add constraint share_beacon_side_check
  check (side in ('app_write', 'extension_read'));
