-- v2: also insert into the public.creators parent table when user_type=creator.
-- creator_profiles has FK creator_id → creators.id, so creators row must exist
-- first. v1 only inserted into creator_profiles and would have failed for new
-- creator signups. Caught during orphan backfill — one creator orphan was
-- missing the creators-table row.
CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_type TEXT := COALESCE(NEW.raw_user_meta_data->>'user_type', 'audience');
  user_name TEXT := COALESCE(NEW.raw_user_meta_data->>'name', '');
BEGIN
  IF user_type = 'creator' THEN
    -- creators is the parent (id+email+name), creator_profiles is the
    -- extended profile (subscription, badges, etc.). Both rows are required.
    INSERT INTO public.creators (id, email, name)
    VALUES (NEW.id, NEW.email, user_name)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.creator_profiles (creator_id, username)
    VALUES (NEW.id, NULLIF(user_name, ''))
    ON CONFLICT (creator_id) DO NOTHING;
  ELSE
    -- 'audience' (or any unrecognized value) → create shopper profile.
    INSERT INTO public.audience_accounts (id, email, name)
    VALUES (NEW.id, NEW.email, user_name)
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
