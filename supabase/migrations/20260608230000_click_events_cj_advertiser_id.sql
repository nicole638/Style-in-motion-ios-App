-- cj_advertiser_id — records which CJ advertiser a wrapped CJ click was
-- attributed to. Set by /api/shop at insert time, sourced from
-- affiliate_merchants.cj_advertiser_id when shop-redirect resolves a CJ
-- merchant against the URL's host.
--
-- Companion to backend/src/routes/shop-redirect.ts CJ click-wrap (added
-- in the same commit). The shop-redirect handler picks the right PID
-- (101740603 for src=ios, 101761822 for everything else) and stamps the
-- click_event_id as `sid` so cj-commissions-sync can reconcile back via
-- cj_commissions.shopper_id = click_events.id::text.
--
-- NULL for non-CJ clicks. Partial index keeps the index tiny since most
-- click_events rows are Amazon (~80%) or Awin.
--
-- Applied to prod via Supabase MCP on 2026-06-08; mirrored here for VCS.

alter table public.click_events
  add column if not exists cj_advertiser_id text;

create index if not exists click_events_cj_advertiser_id_idx
  on public.click_events (cj_advertiser_id)
  where cj_advertiser_id is not null;
