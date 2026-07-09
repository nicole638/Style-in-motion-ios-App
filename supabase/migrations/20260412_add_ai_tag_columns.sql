-- Add AI-generated tag columns to looks table
ALTER TABLE public.looks ADD COLUMN IF NOT EXISTS occasion TEXT[] DEFAULT '{}';
ALTER TABLE public.looks ADD COLUMN IF NOT EXISTS season TEXT[] DEFAULT '{}';
ALTER TABLE public.looks ADD COLUMN IF NOT EXISTS style_vibe TEXT[] DEFAULT '{}';
ALTER TABLE public.looks ADD COLUMN IF NOT EXISTS color_palette TEXT[] DEFAULT '{}';
ALTER TABLE public.looks ADD COLUMN IF NOT EXISTS clothing_type TEXT[] DEFAULT '{}';
ALTER TABLE public.looks ADD COLUMN IF NOT EXISTS ai_tags_generated BOOLEAN DEFAULT FALSE;
ALTER TABLE public.looks ADD COLUMN IF NOT EXISTS ai_tags_raw JSONB DEFAULT NULL;
ALTER TABLE public.looks ADD COLUMN IF NOT EXISTS creator_tags TEXT[] DEFAULT '{}';

-- GIN indexes for fast @> (contains) queries on array columns
CREATE INDEX IF NOT EXISTS idx_looks_occasion ON public.looks USING GIN (occasion);
CREATE INDEX IF NOT EXISTS idx_looks_season ON public.looks USING GIN (season);
CREATE INDEX IF NOT EXISTS idx_looks_style_vibe ON public.looks USING GIN (style_vibe);
CREATE INDEX IF NOT EXISTS idx_looks_color_palette ON public.looks USING GIN (color_palette);
CREATE INDEX IF NOT EXISTS idx_looks_clothing_type ON public.looks USING GIN (clothing_type);
CREATE INDEX IF NOT EXISTS idx_looks_creator_tags ON public.looks USING GIN (creator_tags);
