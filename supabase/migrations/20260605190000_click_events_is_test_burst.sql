-- is_test_burst column + partial index + one-time backfill.
-- Mark synthetic test-burst rows so creator-facing analytics can exclude them.
-- Identified bursts share a clear signature: user_id IS NULL + source IS NULL +
-- a dense sub-minute cluster covering many creators in sequence (see
-- mobile/CHANGES.md §6c for forensics). Going forward, real shopper taps carry
-- source='ios' from the /api/shop ?src=ios query param, so this column is a
-- one-time backfill for legacy data; new real clicks will never have
-- is_test_burst=true.
-- Applied to prod via Supabase MCP on 2026-06-05; this file mirrors it for VCS.
alter table public.click_events
  add column if not exists is_test_burst boolean not null default false;

-- Tiny partial index so analytics queries that filter `where is_test_burst = false`
-- (the new default for creator-facing hooks) don't scan the marked rows.
create index if not exists click_events_is_test_burst_idx
  on public.click_events (clicked_at)
  where is_test_burst = true;

-- Backfill the three identified burst windows. Guard with user_id IS NULL AND
-- source IS NULL so a real signed-in shopper who happened to tap during the
-- same minute is never accidentally marked as test.
update public.click_events
   set is_test_burst = true
 where source is null
   and user_id is null
   and (
        (clicked_at >= '2026-05-18 00:35:00+00' and clicked_at <  '2026-05-18 00:40:00+00')
     or (clicked_at >= '2026-05-26 09:46:00+00' and clicked_at <  '2026-05-26 09:49:00+00')
     or (clicked_at >= '2026-06-03 21:39:00+00' and clicked_at <  '2026-06-03 21:42:00+00')
   );
