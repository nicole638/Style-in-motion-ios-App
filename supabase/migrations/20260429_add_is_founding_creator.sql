-- Founding Creator badge: flags the first 10 beta creators so the app can
-- render the FoundingCreatorBadge on their profiles. Distinct from
-- is_beta_creator (broader subscription/access flag).
-- Nicole flips this to true for the first 10 creators via Supabase Studio.

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS is_founding_creator boolean NOT NULL DEFAULT false;

-- Expose the flag through the public-safe view used by shopper-side reads.
CREATE OR REPLACE VIEW public.creator_profiles_public AS
SELECT
  creator_id, username, bio, location, photo_url,
  caption_style, include_hashtags, include_prices,
  instagram_handle, tiktok_handle, youtube_handle, pinterest_handle,
  instagram_enabled, tiktok_enabled, youtube_enabled, pinterest_enabled,
  follower_count,
  is_beta_creator,
  is_founding_creator
FROM public.creator_profiles;

GRANT SELECT ON public.creator_profiles_public TO anon, authenticated;
