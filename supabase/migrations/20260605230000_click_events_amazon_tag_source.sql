-- amazon_tag_source — records which of the 3-tier Amazon Associates tag
-- resolutions the click_events row used. Set by /api/shop at insert time
-- (see backend/src/routes/shop-redirect.ts → resolveAmazonTag).
--
-- Values:
--   'own'                  — creator's own Associates tag
--   'creator_tracking_id'  — SiM-issued per-creator subtag (creators.amazon_tracking_id)
--   'master'               — global master tag (env fallback)
--   NULL                   — non-Amazon click (Awin / unaffiliated)
--
-- Why: at tax season we need to reconcile Amazon Associates earnings against
-- which creator's tag was actually stamped. Without this column, we can only
-- count clicks per tier post-hoc by re-resolving from the current creator
-- settings — which loses fidelity for any tag that was changed since.
--
-- Applied to prod via Supabase MCP on 2026-06-05; mirrored here for VCS.
-- The CHECK constraint was applied as two separate ALTERs because the
-- initial migration used 'creator_subtag' as the type name; the second
-- aligned it to 'creator_tracking_id' to match shop-redirect.ts's
-- AmazonTagSource type.

alter table public.click_events
  add column if not exists amazon_tag_source text;

alter table public.click_events
  drop constraint if exists click_events_amazon_tag_source_check;

alter table public.click_events
  add constraint click_events_amazon_tag_source_check
  check (amazon_tag_source in ('own', 'creator_tracking_id', 'master'));

-- Partial index: most rows are NULL (non-Amazon). The 3 tier values are
-- what analytics queries GROUP BY, so indexing them only is cheap.
create index if not exists click_events_amazon_tag_source_idx
  on public.click_events (amazon_tag_source)
  where amazon_tag_source is not null;
