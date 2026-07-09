-- source_surface — records which in-app surface a click_events row originated
-- from, orthogonal to `source` (the ios/web channel). First consumer is the
-- Consign modal's "Continue on The RealReal" CTA, which stamps
-- source_surface='consign_modal' alongside affiliate_network='trr_partnership'
-- so we can attribute TheRealReal partnership-LP traffic
-- (therealreal.com/styledinmotion) back to the closet consign flow and ladder
-- it up to commission.
--
-- NULL for the existing shop-link clicks that predate surface tracking.
-- Additive + nullable + no constraint, so this is safe to replay on a DB where
-- the column already exists.
alter table public.click_events
  add column if not exists source_surface text;

-- Partial index: only consign (and future surface-tagged) rows carry a value;
-- the vast majority of click_events are shop-link clicks with NULL surface.
create index if not exists click_events_source_surface_idx
  on public.click_events (source_surface)
  where source_surface is not null;
