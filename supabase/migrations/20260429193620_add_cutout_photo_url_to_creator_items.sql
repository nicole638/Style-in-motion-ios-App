-- Cache bg-removed cutout per item so we run Photoroom (or whichever
-- bg-removal provider) once per item, then reuse across many collages.
ALTER TABLE public.creator_items
  ADD COLUMN IF NOT EXISTS cutout_photo_url text;

-- No index needed — this is read alongside the row, not filtered on.
