-- Brand-catalog (`?url=`) clicks were silently dropping. Root cause: the
-- click_events_context_check CHECK constraint required at least one of look_id /
-- item_id / campaign_id. A look-less `?url=` tap (Addition 2b: a brand-catalog
-- product, not a creator_items row and not in any look) carries NONE of those,
-- so the INSERT failed the check. `shop-redirect.ts` console.warn's the error and
-- 302s anyway, so the Amazon tag + ascsubtag worked while the row never persisted.
--
-- (Earlier theory of a `look_id NOT NULL` violation was wrong — look_id is already
-- nullable. And the `creatorItemId` path was never broken: it sets item_id, which
-- already satisfied the check. Only the pure `?url=` path failed.)
--
-- Fix: also accept any click carrying a `merchant_domain`. Every real shop click
-- resolves a merchant_domain (amazon.com for Amazon, the merchant host otherwise),
-- so this admits genuine brand-catalog taps while still rejecting truly
-- contextless rows (no look/item/campaign AND no merchant).
--
-- Already applied to prod via Supabase MCP and verified end-to-end
-- (GET /api/shop?url=…/dp/B0CHWDPNVH&source=web wrote one row: id=ascsubtag,
-- look_id=null, item_id=null, source='web', affiliate_network='amazon').
-- This file mirrors prod for VCS. `drop constraint if exists` + re-add makes it
-- idempotent / safe to replay.
alter table public.click_events
  drop constraint if exists click_events_context_check;

alter table public.click_events
  add constraint click_events_context_check
  check (
    look_id is not null
    or item_id is not null
    or campaign_id is not null
    or merchant_domain is not null
  );
