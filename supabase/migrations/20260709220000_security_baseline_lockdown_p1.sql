-- Security baseline lockdown, pass 1 (SOC 2 / ISO 27001 alignment, 2026-07-09).
-- Source: Supabase security advisors (209 findings; 21 ERROR). This migration
-- closes 13 ERRORs with zero client impact — verified: none of these objects
-- are referenced by mobile/src, and backend/edge functions use the service
-- role, which bypasses RLS.

-- 1) Internal pipeline tables — enable RLS with NO policies: service-role only.
alter table public.product_info_cache          enable row level security;
alter table public.candidate_fashion_weights   enable row level security;  -- exposed a `token` column
alter table public.campaign_category_exclusions enable row level security;
alter table public.campaign_category_includes  enable row level security;
alter table public.discovery_cursor            enable row level security;
alter table public.trr_campaign_log            enable row level security;
alter table public.cc_campaigns                enable row level security;
alter table public.partnerboost_link_cache     enable row level security;
alter table public.campaign_candidates         enable row level security;

-- 2) Public reference tables — RLS with explicit READ-ONLY policies.
alter table public.vibe_aliases enable row level security;
create policy "Public read" on public.vibe_aliases for select using (true);
alter table public.brand_pins enable row level security;
create policy "Public read" on public.brand_pins for select using (true);

-- 3) creator_cj_earnings view (per-creator earnings — personal financial
--    data) was SELECTable by anon+authenticated with no per-creator filter.
--    Clients use the auth-gated RPCs; only service-role jobs read the view.
revoke select on public.creator_cj_earnings from anon, authenticated;
