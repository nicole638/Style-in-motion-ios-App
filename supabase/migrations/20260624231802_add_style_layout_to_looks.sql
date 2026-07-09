-- Style-a-Look upgrade: movable/resizable/recolorable text blocks + hero photo
-- meta persist on the look so creators can reopen and continue editing.
--
-- Shape (when populated):
--   {
--     "text": [
--       { "id": "...", "text": "...", "fontSize": 96, "color": "#FFFFFF",
--         "fontFamily": "serif" | "serif-italic" | "sans" | "sans-bold",
--         "x": 0..canvasWidth, "y": 0..canvasHeight, "scale": 0.3..2.5,
--         "rotation": deg, "zIndex": int }
--     ],
--     "heroAspectRatio": 0.667,   -- width/height of the hero photo (model = PORTRAIT_HD_3_2)
--     "canvasWidth": 1080,
--     "canvasHeight": 1440
--   }
--
-- NULL = non-style-look or legacy save (no text blocks). The hero image is
-- flattened into cover_photo_url at save time, so feeds/web render correctly
-- without this column; style_layout is re-hydrated only when reopening for edit.
--
-- IMPORTANT: this is SEPARATE from collage_layout. Style-a-Looks keep
-- collage_layout NULL and tags free of 'collage' so the look-type router
-- (tags.includes('collage') && collage_layout -> collage editor) keeps routing
-- them to the Style-a-Look editor.
ALTER TABLE public.looks
  ADD COLUMN IF NOT EXISTS style_layout JSONB DEFAULT NULL;

COMMENT ON COLUMN public.looks.style_layout IS
  'Style-a-Look editor — movable/resizable/recolorable text layers + hero photo meta in 1080-wide canvas space. NULL = non-style-look or legacy save. Cover image is flattened into cover_photo_url, so feeds need no change. Set by mobile/src/app/(tabs)/create.tsx on save; consumed when reopening for edit.';
