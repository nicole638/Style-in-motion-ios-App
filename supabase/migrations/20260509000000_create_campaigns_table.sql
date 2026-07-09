-- Brand partnership and Sponsored Products campaign tracking.
-- Used at click-through time to append &kw= for Sponsored Products campaigns
-- and to surface active deals in the mobile creator dashboard.
--
-- campaign_type:
--   'affiliate_plus'      — Amazon Creator Connections standard; kw is NULL.
--   'sponsored_products'  — Paid placement; kw holds the keyword for &kw= param.
--
-- source: which network/program the campaign came from.

CREATE TABLE IF NOT EXISTS public.campaigns (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_name           text         NOT NULL,
  brand_logo_url       text,
  asins                text[]       NOT NULL DEFAULT '{}',
  start_date           date         NOT NULL,
  end_date             date         NOT NULL,
  commission_rate_pct  numeric(5,2) NOT NULL DEFAULT 0,
  campaign_type        text         NOT NULL
                         CHECK (campaign_type IN ('affiliate_plus', 'sponsored_products')),
  source               text         NOT NULL
                         CHECK (source IN ('amazon_cc', 'cj', 'rakuten', 'awin', 'manual')),
  notes                text,
  budget_total_usd     numeric(12,2),
  budget_remaining_usd numeric(12,2),
  campaign_url         text,
  kw                   text,
  archived_at          timestamptz,
  created_at           timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.campaigns.kw IS
  'Sponsored Products keyword appended as &kw= in the Amazon Special Link. NULL for affiliate_plus campaigns (leave unset — no default).';

-- Range + active-only index for date-window queries.
CREATE INDEX IF NOT EXISTS idx_campaigns_active
  ON public.campaigns (start_date, end_date)
  WHERE archived_at IS NULL;

-- GIN index for ASIN array containment: asins @> ARRAY['B0ABC123XY']
CREATE INDEX IF NOT EXISTS idx_campaigns_asins
  ON public.campaigns USING gin(asins);

-- RLS: platform admins manage rows; public has no direct access.
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON public.campaigns
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
