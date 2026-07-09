-- Convert the 7 alternate_* columns on creator_items into a single
-- alternates jsonb array. Supports up to 2 alternates per item today
-- (MAX_ALTERNATES constant lives in mobile/src/lib/types/alternate.ts).
--
-- The legacy alternate_* columns are KEPT intentionally — older app
-- builds still write/read them. A follow-up migration (~2-3 weeks after
-- this ships, once on-device builds have rolled forward) will drop them.

ALTER TABLE public.creator_items
  ADD COLUMN IF NOT EXISTS alternates jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: any item that has a non-empty alternate_link gets one entry
-- in the new alternates array, mirroring the legacy column shape.
UPDATE public.creator_items
SET alternates = jsonb_build_array(
  jsonb_build_object(
    'brand',     alternate_brand,
    'category',  alternate_category,
    'label',     alternate_label,
    'link',      alternate_link,
    'name',      alternate_name,
    'photo_url', alternate_photo_url,
    'price',     alternate_price
  )
)
WHERE alternate_link IS NOT NULL
  AND alternate_link <> ''
  AND alternates = '[]'::jsonb;

-- Sanity query — both counts should be identical post-backfill:
--
--   SELECT
--     COUNT(*) FILTER (WHERE alternate_link IS NOT NULL AND alternate_link <> '') AS legacy_with_alt,
--     COUNT(*) FILTER (WHERE jsonb_array_length(alternates) > 0) AS new_with_alt
--   FROM creator_items;
