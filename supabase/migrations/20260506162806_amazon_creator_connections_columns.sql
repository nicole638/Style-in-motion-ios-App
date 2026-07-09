-- Catch-up migration for Amazon Creator Connections columns that were
-- applied directly to prod ahead of the codebase. Both ALTERs are idempotent
-- (IF NOT EXISTS) so this file is safe to re-apply against any environment.
--
-- amazon_associates_tag — the creator's own Amazon Associates tag
--   (e.g. 'mycreator-20'). NULL = unset. Format is lowercase letters,
--   digits, and dashes; trailing suffix indicates the regional store
--   (-20 US, -21 UK, -22 ES, etc). No CHECK constraint on suffix because
--   Amazon has multiple stores and creators may operate in any of them.
--
-- amazon_use_own_tag — creator-controlled toggle that decides whether
--   the click-time link generator uses their tag (true) or the platform
--   tag + ascsubtag attribution (false).
--
-- amazon_setup_acknowledged_at — set when creator has actively decided
--   how to handle Amazon attribution. NULL = surface the decision banner
--   in the web dashboard / /profile editor. No backend logic depends on
--   it yet; captured here for schema parity with prod.

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS amazon_associates_tag text;

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS amazon_use_own_tag boolean NOT NULL DEFAULT false;

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS amazon_setup_acknowledged_at timestamptz;

COMMENT ON COLUMN public.creator_profiles.amazon_setup_acknowledged_at IS
  'Set when creator has actively decided how to handle Amazon attribution. NULL = surface the decision banner.';

-- click_events.redirect_url — the final Special Link the shopper was
-- 302'd to, captured at click time so we can audit attribution later
-- without reconstructing it from creator_profiles state (tag + toggle
-- can change after the fact).
ALTER TABLE public.click_events
  ADD COLUMN IF NOT EXISTS redirect_url text;
