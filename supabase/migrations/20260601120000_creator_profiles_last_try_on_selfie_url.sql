-- Remember the most recent selfie a creator uploaded via the "Use my photo"
-- tile in the Try-on Model sheet, so subsequent sessions can default the tile
-- thumbnail to their last upload (and they don't have to re-pick every time).
--
-- The actual bytes live in storage at cutouts/try-on-selfies/{user_id}/{sha}.jpg;
-- this column just holds the public URL pointer.

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS last_try_on_selfie_url TEXT;

COMMENT ON COLUMN public.creator_profiles.last_try_on_selfie_url IS
  'Most recent selfie URL uploaded via the Try-on Model sheet "Use my photo" tile. Public URL in the cutouts bucket. Used to pre-fill the tile thumbnail on subsequent sessions; rewritten on every new upload.';
