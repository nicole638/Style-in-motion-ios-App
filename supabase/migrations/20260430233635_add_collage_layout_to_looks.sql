-- Phase 2 of the collage builder: per-item drag/pinch positions persist on
-- the look so users can reopen and continue editing.
--
-- Shape (when populated):
--   {
--     "template": "style-journal" | "editorial" | "grid",
--     "items": [
--       { "itemId": "...", "x": 0..1080, "y": 0..1080, "scale": 0.3..2.5, "zIndex": int }
--     ]
--   }
--
-- NULL = auto-template / Phase-1-style save. Mobile hides the edit button
-- for these so the older saves stay viewable but read-only.
ALTER TABLE public.looks
  ADD COLUMN IF NOT EXISTS collage_layout JSONB DEFAULT NULL;

COMMENT ON COLUMN public.looks.collage_layout IS
  'Phase 2 collage editor — per-item position/scale/z-index transforms in 1080×1080 canvas space. NULL = auto-template (Phase 1 collage save or non-collage look). Set by mobile/src/app/collage-builder.tsx on save; consumed when reopening for edit.';
