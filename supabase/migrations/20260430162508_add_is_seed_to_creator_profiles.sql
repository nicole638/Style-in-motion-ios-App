-- Flag seed/demo creators so metrics queries can exclude them and avoid
-- skewing signup, engagement, and conversion numbers. Seed creators stay
-- visible in production app feeds (they provide content for first-time
-- shoppers); only analytics queries filter them out via WHERE is_seed = false.
--
-- Will be revisited before public launch — at that point we either delete
-- seed creators entirely or keep them with a clearer "demo" UI affordance.
ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS is_seed BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_creator_profiles_is_seed
  ON public.creator_profiles (is_seed)
  WHERE is_seed = false;

COMMENT ON COLUMN public.creator_profiles.is_seed IS
  'True for placeholder/demo creators (a1111111, b2222222, c3333333) seeded during initial bootstrapping. Metrics queries should filter WHERE is_seed = false to get real-user numbers. Production app feeds may still show these.';
