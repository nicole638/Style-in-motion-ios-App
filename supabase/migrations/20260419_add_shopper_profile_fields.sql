-- Add shopper-side profile fields to audience_accounts
-- Enables the shopper profile page to store an avatar and optional location.
ALTER TABLE public.audience_accounts ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
ALTER TABLE public.audience_accounts ADD COLUMN IF NOT EXISTS location TEXT;
