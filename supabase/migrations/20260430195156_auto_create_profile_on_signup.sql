-- Auto-create audience_accounts or creator_profiles on auth.users INSERT.
--
-- Why: app-side INSERTs in mobile/src/lib/state/authStore.ts hit an early
-- return when email confirmation is required, so the profile row never got
-- created. Result: 19 orphan auth.users with no profile, broken signup flow.
--
-- This trigger makes profile creation atomic with auth.users INSERT — the
-- app code can't possibly miss it again. Uses SECURITY DEFINER so RLS on
-- the public tables doesn't block the insert (the user has no session yet
-- when this fires).
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
    INSERT INTO public.creator_profiles (creator_id, username)
    VALUES (NEW.id, NULLIF(user_name, ''))
    ON CONFLICT (creator_id) DO NOTHING;
  ELSE
    -- 'audience' (or any unrecognized value) → create shopper profile.
    -- name column is NOT NULL but accepts empty string.
    INSERT INTO public.audience_accounts (id, email, name)
    VALUES (NEW.id, NEW.email, user_name)
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_signup();

COMMENT ON FUNCTION public.handle_new_user_signup() IS
  'Creates the matching public profile row (audience_accounts or creator_profiles) when a new auth.users row is inserted. Reads user_type and name from raw_user_meta_data. Replaces fragile app-side INSERTs that previously got skipped when email confirmation was required.';
