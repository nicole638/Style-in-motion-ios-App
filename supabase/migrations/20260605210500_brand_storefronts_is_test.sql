-- Filterable test flag on brand storefronts so the QA "Test Brand" can be
-- cleanly excluded from public lists, admin dashboards, analytics, and
-- attribution roll-ups without name-matching hacks.
--
-- Applied to prod via Supabase MCP on 2026-06-05; mirrored here for VCS.
alter table public.brand_storefronts
  add column if not exists is_test boolean not null default false;

-- Partial index: tiny by definition because is_test=true rows are the minority
-- and the column ships at default false. Used by the "/admin show test data"
-- toggle and by exclusion filters in analytics queries.
create index if not exists brand_storefronts_is_test_idx
  on public.brand_storefronts(is_test) where is_test = true;
