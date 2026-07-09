-- ────────────────────────────────────────────────────────────────────────────
-- Shopper closets — tag the `creators` identity row by account type.
--
-- Context: the `creators.account_type` column was added to prod via Supabase MCP
-- on 2026-07-02 (Shopper Closet MVP). This file is the missing version-control
-- mirror of that change — schema discipline (docs/schema-discipline.md) requires
-- a paired migration file, and `supabase db diff` must return empty in CI.
--
-- 'creator' (default) = human creators + all existing accounts.
-- 'partner_brand'     = brand storefront content accounts (kept for parity with
--                        creator_profiles.account_type, harmless on creators).
-- 'shopper'           = audience users who opened a personal closet. Excluded
--                        from creator analytics / nudges / directory; their looks
--                        stay private (published_at NULL). See the MVP spec.
--
-- Fully idempotent: safe to re-run, and safe whether or not the CHECK already
-- allowed 'shopper' (it drops any pre-existing account_type check on creators
-- and recreates the canonical one).
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Column (mirror of the live change).
alter table public.creators
  add column if not exists account_type text not null default 'creator';

-- 2. CHECK constraint — allow 'shopper'. Drop any existing check constraint on
--    public.creators whose definition references account_type (whatever it was
--    named), then add the canonical one. This repairs the case where an earlier
--    apply copied the creator_profiles constraint that only allowed
--    ('creator','partner_brand') and would reject shopper inserts.
do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'creators'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%account_type%'
  loop
    execute format('alter table public.creators drop constraint %I', c.conname);
  end loop;

  alter table public.creators
    add constraint creators_account_type_check
    check (account_type in ('creator', 'partner_brand', 'shopper'));
end $$;

-- 3. Index (analytics/nudge queries filter shoppers out; directory reads filter
--    creators in). Partial-free btree is enough at this scale.
create index if not exists creators_account_type_idx
  on public.creators (account_type);
