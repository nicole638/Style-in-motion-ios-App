-- ────────────────────────────────────────────────────────────────────────────
-- Bridge: cj_commissions → commissions
--
-- cj-commissions-sync writes raw CJ records (commissionId, shopperId,
-- advertiserId, action/validation status, USD amounts, dates) into
-- public.cj_commissions. The creators-web /earnings UI + iOS earnings hooks
-- read from public.commissions — the unified per-network commission ledger.
--
-- This trigger translates each cj_commissions row into a commissions row so
-- CJ revenue surfaces alongside Amazon and Awin without per-network
-- branching in the UI.
--
-- Key resolution chain (see backend/src/routes/shop-redirect.ts CJ wrap):
--   shopper_id (text, set as ?sid={click_event_id} in our DLG URL)
--   ::uuid → click_events.id
--          → click_events.creator_id, look_id, item_id
--
-- Share convention: matches lib/earnings/mutations.ts:148 —
-- creator_share defaults to commission_total when no platform fee is
-- configured. SiM does not take a cut on affiliate commissions today.
-- Change here when policy changes.
--
-- Status mapping (CJ action_status × validation_status × locking_date →
-- commissions.status):
--   locking_date IS NOT NULL                                          → 'paid'
--   validation_status = 'rejected'                                    → 'reversed'
--   correction_reason IS NOT NULL AND validation_status IN
--     ('rejected','reversed')                                         → 'reversed'
--   validation_status IN ('approved','validated')                     → 'confirmed'
--   else                                                              → 'pending'
--
-- Applied to prod via Supabase MCP on 2026-06-08; mirrored here for VCS.
-- ────────────────────────────────────────────────────────────────────────────

-- Unique constraint backing the trigger upsert. Two CJ commission
-- corrections share the same commission_id but write different
-- action_status / amounts; the bridge upserts on conflict so the latest
-- CJ row always wins.
create unique index if not exists commissions_network_txn_unique
  on public.commissions (affiliate_network, affiliate_transaction_id)
  where affiliate_transaction_id is not null;

create or replace function public.bridge_cj_commission_to_commissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_click_event_id  uuid;
  v_creator_id      uuid;
  v_merchant_domain text;
  v_status          text;
  v_paid_at         timestamptz;
  v_confirmed_at    timestamptz;
begin
  -- Skip rows we can't resolve back to a click. CJ may surface commissions
  -- from CJ-internal redirects (rare; usually impressions / publisher direct
  -- links) where shopper_id wasn't stamped via our wrap. We don't want to
  -- pollute the commissions table with un-attributable revenue.
  if new.shopper_id is null or new.shopper_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return new;
  end if;

  begin
    v_click_event_id := new.shopper_id::uuid;
  exception when others then
    return new;  -- malformed UUID — silently skip; raw row still in cj_commissions
  end;

  -- Pull creator_id from the click_events row. Allow NULL — historical
  -- click_events rows could be missing creator_id (the shop-redirect always
  -- stamps it now, but old rows pre-§6 may not). If creator_id is null,
  -- the commission row still records the revenue but won't surface in
  -- per-creator /earnings; that's a recoverable state.
  select ce.creator_id
    into v_creator_id
    from public.click_events ce
   where ce.id = v_click_event_id;

  -- Merchant domain from cj_merchants (matches what shop-redirect stamped on
  -- the click_events row, but we re-query in case cj_merchants got updated).
  select cm.domain
    into v_merchant_domain
    from public.cj_merchants cm
   where cm.cj_advertiser_id = new.advertiser_id;

  if new.locking_date is not null then
    v_status := 'paid';
    v_paid_at := new.locking_date;
    v_confirmed_at := coalesce(new.posting_date, new.event_date);
  elsif new.validation_status in ('rejected') then
    v_status := 'reversed';
  elsif new.correction_reason is not null
        and lower(coalesce(new.validation_status,'')) in ('rejected','reversed') then
    v_status := 'reversed';
  elsif lower(coalesce(new.validation_status,'')) in ('approved','validated') then
    v_status := 'confirmed';
    v_confirmed_at := coalesce(new.posting_date, new.event_date);
  else
    v_status := 'pending';
  end if;

  insert into public.commissions (
    affiliate_network,
    affiliate_transaction_id,
    click_event_id,
    creator_id,
    merchant_name,
    merchant_domain,
    sale_amount,
    commission_total,
    creator_share,
    platform_share,
    status,
    order_date,
    confirmed_at,
    paid_at
  ) values (
    'cj',
    new.commission_id,
    v_click_event_id,
    v_creator_id,
    new.advertiser_name,
    v_merchant_domain,
    new.sale_amount_usd,
    new.pub_commission_amount_usd,
    new.pub_commission_amount_usd,   -- creator_share = commission_total (100%)
    0,                                -- platform_share = 0 (no SiM cut today)
    v_status,
    coalesce(new.event_date, new.posting_date),
    v_confirmed_at,
    v_paid_at
  )
  on conflict (affiliate_network, affiliate_transaction_id)
    where affiliate_transaction_id is not null
    do update set
      click_event_id   = excluded.click_event_id,
      creator_id       = excluded.creator_id,
      merchant_name    = excluded.merchant_name,
      merchant_domain  = excluded.merchant_domain,
      sale_amount      = excluded.sale_amount,
      commission_total = excluded.commission_total,
      creator_share    = excluded.creator_share,
      platform_share   = excluded.platform_share,
      status           = excluded.status,
      order_date       = excluded.order_date,
      confirmed_at     = coalesce(excluded.confirmed_at, public.commissions.confirmed_at),
      paid_at          = coalesce(excluded.paid_at,      public.commissions.paid_at);

  return new;
end;
$$;

drop trigger if exists trg_bridge_cj_commission on public.cj_commissions;
create trigger trg_bridge_cj_commission
  after insert or update on public.cj_commissions
  for each row execute function public.bridge_cj_commission_to_commissions();
