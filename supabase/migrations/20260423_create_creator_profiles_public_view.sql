-- Public-safe view of creator_profiles.
-- Excludes stripe_customer_id (billing PII) and subscription_status (internal).
-- Shopper-side queries should read from this view instead of the base table.

CREATE OR REPLACE VIEW public.creator_profiles_public AS
SELECT
  creator_id, username, bio, location, photo_url,
  caption_style, include_hashtags, include_prices,
  instagram_handle, tiktok_handle, youtube_handle, pinterest_handle,
  instagram_enabled, tiktok_enabled, youtube_enabled, pinterest_enabled,
  follower_count,
  is_beta_creator
FROM public.creator_profiles;

GRANT SELECT ON public.creator_profiles_public TO anon, authenticated;
