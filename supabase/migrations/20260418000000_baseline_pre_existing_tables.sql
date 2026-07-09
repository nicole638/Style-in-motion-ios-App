-- ────────────────────────────────────────────────────────────────────────
-- Baseline capture for tables that pre-date the 20260418 migration history.
-- Captured retroactively from prod 2026-05-05 to support a clean
-- `supabase db reset` against a fresh local DB. Never edit this file —
-- only add new migrations after it.
--
-- Tables included: creators, categories, click_events, commissions,
-- payouts, look_events, likes.
-- All DDL is idempotent (IF NOT EXISTS) so this is safe to apply on a DB
-- where the tables already exist.
-- ────────────────────────────────────────────────────────────────────────

-- creators ─────────────────────────────────────────────────────────────
-- Parent table for creator accounts. Mirrors auth.users rows for users
-- with user_type='creator'. Profile detail lives in creator_profiles
-- (extended via FK creator_id → creators.id).
CREATE TABLE IF NOT EXISTS public.creators (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  first_name  text,
  last_name   text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.creators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Creators are viewable by everyone"
  ON public.creators FOR SELECT TO public USING (true);

CREATE POLICY "Users can insert their own creator record"
  ON public.creators FOR INSERT TO public
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own creator record"
  ON public.creators FOR UPDATE TO public
  USING (auth.uid() = id);

-- categories ───────────────────────────────────────────────────────────
-- Top-level taxonomy used for closet item categorization and shopper
-- discovery filters. RLS is also tightened in 20260422023402.
CREATE TABLE IF NOT EXISTS public.categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  slug        text NOT NULL UNIQUE,
  icon        text,
  sort_order  integer DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Categories are viewable by everyone"
  ON public.categories FOR SELECT TO public USING (true);

-- click_events ─────────────────────────────────────────────────────────
-- Affiliate / shop-look click tracking. Built against Skimlinks taxonomy
-- but column shape (affiliate_network, merchant_domain, was_affiliated)
-- is generic enough for CJ. 0 rows in prod as of 2026-05-05 — clear-eyed
-- this is set up but not yet wired to live shopper traffic.
CREATE TABLE IF NOT EXISTS public.click_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  look_id            uuid NOT NULL REFERENCES public.looks(id) ON DELETE CASCADE,
  item_id            uuid REFERENCES public.creator_items(id) ON DELETE SET NULL,
  user_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  creator_id         uuid,
  item_url           text,
  was_affiliated     boolean DEFAULT false,
  affiliate_network  text,
  merchant_domain    text,
  clicked_at         timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_click_events_look_id
  ON public.click_events (look_id);

ALTER TABLE public.click_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can log clicks"
  ON public.click_events FOR INSERT TO public
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.looks l
      WHERE l.id = click_events.look_id AND l.archived = false
    )
  );

CREATE POLICY "Creators can view clicks on their looks"
  ON public.click_events FOR SELECT TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.looks
      WHERE looks.id = click_events.look_id AND looks.creator_id = auth.uid()
    )
  );

-- commissions ──────────────────────────────────────────────────────────
-- Affiliate commission ledger. Originally built for Skimlinks (note the
-- skimlinks_transaction_id column). With the move to CJ (#27), this
-- column should be renamed to a network-agnostic affiliate_transaction_id
-- in a follow-up migration. 0 rows as of 2026-05-05.
CREATE TABLE IF NOT EXISTS public.commissions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id               uuid REFERENCES public.creator_profiles(creator_id),
  skimlinks_transaction_id text UNIQUE,
  order_date               timestamptz,
  merchant_name            text,
  merchant_domain          text,
  sale_amount              numeric,
  commission_total         numeric,
  creator_share            numeric,
  platform_share           numeric,
  creator_tier             text,
  status                   text DEFAULT 'pending'
                             CHECK (status IN ('pending','confirmed','paid','rejected')),
  confirmed_at             timestamptz,
  paid_at                  timestamptz,
  created_at               timestamptz DEFAULT now()
);

ALTER TABLE public.commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "creators read own commissions"
  ON public.commissions FOR SELECT TO public
  USING (creator_id = auth.uid());

CREATE POLICY "service role manages commissions"
  ON public.commissions FOR ALL TO public
  USING (auth.role() = 'service_role');

-- payouts ──────────────────────────────────────────────────────────────
-- Creator payout ledger. Companion to commissions. 0 rows as of 2026-05-05.
CREATE TABLE IF NOT EXISTS public.payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id    uuid REFERENCES public.creator_profiles(creator_id),
  amount        numeric NOT NULL,
  method        text NOT NULL,
  reference     text,
  status        text DEFAULT 'processing'
                  CHECK (status IN ('processing','completed','failed')),
  created_at    timestamptz DEFAULT now(),
  completed_at  timestamptz
);

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "creators read own payouts"
  ON public.payouts FOR SELECT TO public
  USING (creator_id = auth.uid());

CREATE POLICY "service role manages payouts"
  ON public.payouts FOR ALL TO public
  USING (auth.role() = 'service_role');

-- look_events ──────────────────────────────────────────────────────────
-- Look-level analytics: views and clicks bucketed by source (feed,
-- discover, profile, search). 0 rows in prod — set up for analytics
-- ingest that hasn't been wired in mobile yet.
CREATE TABLE IF NOT EXISTS public.look_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  look_id     uuid REFERENCES public.looks(id) ON DELETE CASCADE,
  creator_id  uuid NOT NULL,
  event_type  text NOT NULL CHECK (event_type IN ('view','click')),
  source      text CHECK (source IN ('following','discover','profile','search')),
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_look_events_look_id
  ON public.look_events (look_id);
CREATE INDEX IF NOT EXISTS idx_look_events_creator_id
  ON public.look_events (creator_id);
CREATE INDEX IF NOT EXISTS idx_look_events_created_at
  ON public.look_events (created_at);

ALTER TABLE public.look_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users insert events"
  ON public.look_events FOR INSERT TO public
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "creators read own events"
  ON public.look_events FOR SELECT TO public
  USING (creator_id = auth.uid());

-- likes ────────────────────────────────────────────────────────────────
-- Look engagement (heart). UNIQUE (user_id, look_id) prevents double-likes.
-- 0 rows as of 2026-05-05 — heart UI not yet wired in shopper feed.
CREATE TABLE IF NOT EXISTS public.likes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  look_id     uuid NOT NULL REFERENCES public.looks(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, look_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_user_id ON public.likes (user_id);
CREATE INDEX IF NOT EXISTS idx_likes_look_id ON public.likes (look_id);

ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own likes"
  ON public.likes FOR SELECT TO public
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own likes"
  ON public.likes FOR INSERT TO public
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own likes"
  ON public.likes FOR DELETE TO public
  USING (auth.uid() = user_id);
