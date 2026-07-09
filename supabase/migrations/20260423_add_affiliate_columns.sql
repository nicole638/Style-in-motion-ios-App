-- Add affiliate link columns to creator_items
ALTER TABLE public.creator_items ADD COLUMN IF NOT EXISTS affiliate_url TEXT DEFAULT NULL;
ALTER TABLE public.creator_items ADD COLUMN IF NOT EXISTS affiliate_provider TEXT DEFAULT NULL;
ALTER TABLE public.creator_items ADD COLUMN IF NOT EXISTS affiliate_wrapped_at TIMESTAMPTZ DEFAULT NULL;

-- Index for backfill queries (find un-wrapped Amazon items)
CREATE INDEX IF NOT EXISTS idx_creator_items_affiliate_url ON public.creator_items (affiliate_url) WHERE affiliate_url IS NULL;
