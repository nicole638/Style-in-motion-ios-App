-- Phase 5: web-only subscription pipeline.
-- Stripe Checkout on styledinmotion.studio writes subscription_status via webhook.
-- Mobile app reads (subscription_status = 'active' OR is_beta_creator = true) to gate creator features.

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS is_beta_creator boolean NOT NULL DEFAULT false;

-- subscription_status values: 'free' | 'trialing' | 'active' | 'past_due' | 'canceled'
ALTER TABLE public.creator_profiles
  ADD CONSTRAINT creator_profiles_subscription_status_check
  CHECK (subscription_status IN ('free', 'trialing', 'active', 'past_due', 'canceled'));

-- Unique Stripe customer per creator
CREATE UNIQUE INDEX IF NOT EXISTS creator_profiles_stripe_customer_id_uq
  ON public.creator_profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- Index for "who currently has access" lookups
CREATE INDEX IF NOT EXISTS creator_profiles_access_idx
  ON public.creator_profiles (subscription_status, is_beta_creator);

-- Grandfather every creator who exists at cutover
UPDATE public.creator_profiles
SET is_beta_creator = true
WHERE creator_id IN (
  'b2222222-2222-2222-2222-222222222222',
  'a1111111-1111-1111-1111-111111111111',
  'c3333333-3333-3333-3333-333333333333',
  '6b67687c-c780-4358-84cc-7d6fc284839c',
  '8390038f-f0be-426c-8b08-8716042282c5',
  'a7a3c8e2-9683-4a3c-aa65-18c69b453ac7',
  'cc2607f4-fde7-4db6-9a51-36b2684dbc8d'
);
