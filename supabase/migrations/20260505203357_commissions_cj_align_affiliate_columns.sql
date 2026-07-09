-- CJ-align commissions: replace Skimlinks-specific column with a
-- network-agnostic one, add affiliate_network identifier. Safe rename:
-- 0 rows in commissions/payouts in prod (verified 2026-05-05) and
-- Skimlinks was deprecated before any rows landed (CJ compliance #27).

ALTER TABLE public.commissions
  RENAME COLUMN skimlinks_transaction_id TO affiliate_transaction_id;

ALTER TABLE public.commissions
  RENAME CONSTRAINT commissions_skimlinks_transaction_id_key
  TO commissions_affiliate_transaction_id_key;

-- Add the affiliate_network identifier so we can tell rows from different
-- networks apart (CJ today; potentially Rakuten/Awin/etc. later).
ALTER TABLE public.commissions
  ADD COLUMN IF NOT EXISTS affiliate_network text;

COMMENT ON COLUMN public.commissions.affiliate_transaction_id IS
  'The affiliate network''s unique transaction/commission identifier. For CJ this is commission_id; for other networks it''s their equivalent.';

COMMENT ON COLUMN public.commissions.affiliate_network IS
  'Source affiliate network: ''cj'' (Commission Junction), ''rakuten'', ''awin'', etc. Required for new rows once CJ ingestion is wired.';
