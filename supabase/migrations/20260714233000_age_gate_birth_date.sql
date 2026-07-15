-- Age gate: store a self-declared date of birth for every new account.
--
-- Apple's UGC questionnaire requires under-13s to have no social access. Product
-- decision goes further: minimum age to create ANY Styled in Motion account is
-- 16 (enforced client-side at signup — see mobile lib/age.ts). We persist the
-- declared birth date so the gate is auditable. Existing rows stay NULL (we
-- never collected it); the gate applies to new signups going forward.
--
-- birth_date is PII; creators/audience_accounts are already RLS-restricted to
-- the owning user + service role. No CHECK on age here — age is time-dependent,
-- so the "16+" rule lives at signup, not as a table constraint.

ALTER TABLE public.creators          ADD COLUMN IF NOT EXISTS birth_date date;
ALTER TABLE public.audience_accounts ADD COLUMN IF NOT EXISTS birth_date date;

COMMENT ON COLUMN public.creators.birth_date IS
  'Self-declared DOB from signup; account creation is gated to 16+ (Apple UGC / under-13 rule). NULL for pre-gate accounts.';
COMMENT ON COLUMN public.audience_accounts.birth_date IS
  'Self-declared DOB from signup; account creation is gated to 16+ (Apple UGC / under-13 rule). NULL for pre-gate accounts.';

-- Persist birth_date from signup metadata. Faithful reproduction of the existing
-- trigger with birth_date added to the DECLARE block and both INSERTs.
CREATE OR REPLACE FUNCTION public.handle_new_user_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  username_slug TEXT := NULLIF(
    left(
      trim(both '-' from
        regexp_replace(
          regexp_replace(lower(user_name), '[^a-z0-9._-]+', '-', 'g'),
          '-+', '-', 'g'
        )
      ),
      60
    ),
    ''
  );
  user_birth_date DATE;
BEGIN
  -- Bad/empty birth_date must never block account creation.
  BEGIN
    user_birth_date := NULLIF(NEW.raw_user_meta_data->>'birth_date', '')::date;
  EXCEPTION WHEN others THEN
    user_birth_date := NULL;
  END;

  IF user_type = 'creator' THEN
    INSERT INTO public.creators (id, email, name, first_name, last_name, birth_date)
    VALUES (NEW.id, NEW.email, user_name, NULLIF(user_first, ''), NULLIF(user_last, ''), user_birth_date)
    ON CONFLICT (id) DO NOTHING;

    BEGIN
      INSERT INTO public.creator_profiles (creator_id, username, first_name, last_name)
      VALUES (NEW.id, username_slug, NULLIF(user_first, ''), NULLIF(user_last, ''))
      ON CONFLICT (creator_id) DO UPDATE
        SET username   = COALESCE(creator_profiles.username,   excluded.username),
            first_name = COALESCE(creator_profiles.first_name, excluded.first_name),
            last_name  = COALESCE(creator_profiles.last_name,  excluded.last_name);
    EXCEPTION
      WHEN unique_violation THEN
        INSERT INTO public.creator_profiles (creator_id, username, first_name, last_name)
        VALUES (NEW.id, NULL, NULLIF(user_first, ''), NULLIF(user_last, ''))
        ON CONFLICT (creator_id) DO UPDATE
          SET first_name = COALESCE(creator_profiles.first_name, excluded.first_name),
              last_name  = COALESCE(creator_profiles.last_name,  excluded.last_name);
    END;

    IF COALESCE((NEW.raw_user_meta_data->>'agreement_accepted')::boolean, false) THEN
      BEGIN
        PERFORM record_creator_agreement_acceptance(
          NEW.id,
          COALESCE(NULLIF(NEW.raw_user_meta_data->>'agreement_source',''), 'web'),
          NULLIF(NEW.raw_user_meta_data->>'agreement_version',''),
          NULL, NULL
        );
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;
  ELSE
    INSERT INTO public.audience_accounts (id, email, name, first_name, last_name, birth_date)
    VALUES (NEW.id, NEW.email, user_name, NULLIF(user_first, ''), NULLIF(user_last, ''), user_birth_date)
    ON CONFLICT (id) DO NOTHING;

    IF COALESCE((NEW.raw_user_meta_data->>'agreement_accepted')::boolean, false)
       OR COALESCE((NEW.raw_user_meta_data->>'terms_accepted')::boolean, false) THEN
      BEGIN
        UPDATE public.audience_accounts
          SET terms_accepted_at = now(),
              terms_version = COALESCE(
                NULLIF(NEW.raw_user_meta_data->>'terms_version',''),
                NULLIF(NEW.raw_user_meta_data->>'agreement_version','')
              ),
              terms_source = COALESCE(
                NULLIF(NEW.raw_user_meta_data->>'terms_source',''),
                NULLIF(NEW.raw_user_meta_data->>'agreement_source',''),
                'web'
              )
        WHERE id = NEW.id;
      EXCEPTION WHEN others THEN
        NULL;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
