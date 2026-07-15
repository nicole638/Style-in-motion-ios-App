-- Launch-time Creator Agreement gate — server side.
--
-- Context: the current agreement version (creator_agreement_versions.is_current)
-- is 'v1', effective 2026-07-07, and ZERO of 50 creators have accepted it — all
-- prior acceptances are for the superseded 'legacy-tos'. Acceptance was only ever
-- captured as a signup checkbox, so bumping the version silently left the whole
-- creator base un-agreed to the current terms. These two RPCs let the mobile app
-- gate a logged-in creator on next open until they accept the current version.
--
-- Both operate on auth.uid() ONLY — a creator can check and accept for themselves
-- and no one else. No creator_id parameter is accepted, so there is nothing to
-- forge. Granted to authenticated only (the gate never runs while logged out).

-- Status: is the current signed-in creator missing the current agreement?
CREATE OR REPLACE FUNCTION public.creator_agreement_status()
RETURNS TABLE(is_creator boolean, current_version text, accepted boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  WITH me AS (SELECT auth.uid() AS uid),
  cur AS (
    SELECT version
    FROM creator_agreement_versions
    WHERE is_current
    ORDER BY effective_date DESC
    LIMIT 1
  )
  SELECT
    EXISTS (SELECT 1 FROM creators c, me WHERE c.id = me.uid)                      AS is_creator,
    (SELECT version FROM cur)                                                       AS current_version,
    EXISTS (
      SELECT 1 FROM creator_agreement_acceptances a, me, cur
      WHERE a.creator_id = me.uid AND a.version = cur.version
    )                                                                              AS accepted;
$function$;

-- Accept the current agreement as the signed-in creator. Idempotent (the
-- underlying record fn upserts on (creator_id, version)). Returns the version
-- that was accepted, or null if the caller is not a creator.
CREATE OR REPLACE FUNCTION public.accept_current_creator_agreement(p_source text DEFAULT 'ios')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version text;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM creators WHERE id = v_uid) THEN RETURN NULL; END IF;

  SELECT version INTO v_version
  FROM creator_agreement_versions
  WHERE is_current
  ORDER BY effective_date DESC
  LIMIT 1;
  IF v_version IS NULL THEN RETURN NULL; END IF;

  PERFORM record_creator_agreement_acceptance(v_uid, coalesce(p_source, 'ios'), v_version, NULL, NULL);
  RETURN v_version;
END;
$function$;

REVOKE ALL ON FUNCTION public.creator_agreement_status() FROM public;
REVOKE ALL ON FUNCTION public.accept_current_creator_agreement(text) FROM public;
GRANT EXECUTE ON FUNCTION public.creator_agreement_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_current_creator_agreement(text) TO authenticated;
