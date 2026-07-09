-- Adds a column to preserve the original merchant CDN URL after we cache
-- the image to our own Supabase Storage. After the cache-on-save flow ships:
--   photo_url = our cached Supabase URL (always rendered)
--   original_photo_url = the merchant URL we fetched from (debug, re-cache, fallback)
--   cutout_photo_url = Photoroom-processed garment-only version (already exists)
--
-- Nullable because (a) creator-uploaded photos won't have an "original"
-- merchant URL, and (b) backfill happens incrementally, not all-at-once.
ALTER TABLE public.creator_items
  ADD COLUMN IF NOT EXISTS original_photo_url TEXT;

COMMENT ON COLUMN public.creator_items.original_photo_url IS
  'Source merchant CDN URL when photo_url was cached to our Storage. NULL for creator-uploaded photos and for items pre-dating the cache-on-save flow.';
