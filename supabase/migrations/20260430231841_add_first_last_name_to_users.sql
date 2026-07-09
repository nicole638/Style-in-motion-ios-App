-- First/last name fields for both shopper and creator profiles. Nullable
-- initially so existing rows don't break; mobile signup will require them
-- for new signups. Backfill of existing rows splits the existing single
-- `name` field on the first space.
ALTER TABLE public.audience_accounts
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

ALTER TABLE public.creator_profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

ALTER TABLE public.creators
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Backfill audience_accounts from existing name field
-- "Megan Dever" → first_name='Megan', last_name='Dever'
-- "Nicole" → first_name='Nicole', last_name=''
UPDATE public.audience_accounts
SET
  first_name = COALESCE(first_name, split_part(NULLIF(name, ''), ' ', 1)),
  last_name  = COALESCE(last_name,
                  CASE
                    WHEN position(' ' IN COALESCE(name, '')) > 0
                      THEN trim(substring(name FROM position(' ' IN name) + 1))
                    ELSE ''
                  END)
WHERE name IS NOT NULL AND name <> '';

-- Backfill creators table from existing name field
UPDATE public.creators
SET
  first_name = COALESCE(first_name, split_part(NULLIF(name, ''), ' ', 1)),
  last_name  = COALESCE(last_name,
                  CASE
                    WHEN position(' ' IN COALESCE(name, '')) > 0
                      THEN trim(substring(name FROM position(' ' IN name) + 1))
                    ELSE ''
                  END)
WHERE name IS NOT NULL AND name <> '';

-- Update the signup trigger to populate first_name + last_name from
-- raw_user_meta_data (mobile will start sending these) with fallback to
-- splitting `name` on first space if first_name/last_name not in metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_type TEXT := COALESCE(NEW.raw_user_meta_data->>'user_type', 'audience');
  user_name TEXT := COALESCE(NEW.raw_user_meta_data->>'name', '');
  user_first TEXT := COALESCE(
    NEW.raw_user_meta_data->>'first_name',
    split_part(NULLIF(user_name, ''), ' ', 1)
  );
  user_last TEXT := COALESCE(
    NEW.raw_user_meta_data->>'last_name',
    CASE WHEN position(' ' IN user_name) > 0
      THEN trim(substring(user_name FROM position(' ' IN user_name) + 1))
      ELSE ''
    END
  );
BEGIN
  IF user_type = 'creator' THEN
    INSERT INTO public.creators (id, email, name, first_name, last_name)
    VALUES (NEW.id, NEW.email, user_name, NULLIF(user_first, ''), NULLIF(user_last, ''))
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.creator_profiles (creator_id, username, first_name, last_name)
    VALUES (NEW.id, NULLIF(user_name, ''), NULLIF(user_first, ''), NULLIF(user_last, ''))
    ON CONFLICT (creator_id) DO NOTHING;
  ELSE
    INSERT INTO public.audience_accounts (id, email, name, first_name, last_name)
    VALUES (NEW.id, NEW.email, user_name, NULLIF(user_first, ''), NULLIF(user_last, ''))
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
