-- Fix storage RLS for look-photos, item-photos, and profile-photos buckets.
-- Diagnostic confirmed: auth token IS present and valid on uploads, but the
-- storage.objects RLS policies are missing, causing every authenticated upload to 403.
-- Rule: authenticated users can write; public (anon+authenticated) can read.

-- ── look-photos ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "look-photos insert authenticated" ON storage.objects;
DROP POLICY IF EXISTS "look-photos update owner"         ON storage.objects;
DROP POLICY IF EXISTS "look-photos delete owner"         ON storage.objects;
DROP POLICY IF EXISTS "look-photos select public"        ON storage.objects;

CREATE POLICY "look-photos insert authenticated"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'look-photos');

CREATE POLICY "look-photos update owner"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'look-photos' AND owner = auth.uid());

CREATE POLICY "look-photos delete owner"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'look-photos' AND owner = auth.uid());

CREATE POLICY "look-photos select public"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'look-photos');

-- ── item-photos ───────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "item-photos insert authenticated" ON storage.objects;
DROP POLICY IF EXISTS "item-photos update owner"         ON storage.objects;
DROP POLICY IF EXISTS "item-photos delete owner"         ON storage.objects;
DROP POLICY IF EXISTS "item-photos select public"        ON storage.objects;

CREATE POLICY "item-photos insert authenticated"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'item-photos');

CREATE POLICY "item-photos update owner"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'item-photos' AND owner = auth.uid());

CREATE POLICY "item-photos delete owner"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'item-photos' AND owner = auth.uid());

CREATE POLICY "item-photos select public"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'item-photos');

-- ── profile-photos ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "profile-photos insert authenticated" ON storage.objects;
DROP POLICY IF EXISTS "profile-photos update owner"         ON storage.objects;
DROP POLICY IF EXISTS "profile-photos delete owner"         ON storage.objects;
DROP POLICY IF EXISTS "profile-photos select public"        ON storage.objects;

CREATE POLICY "profile-photos insert authenticated"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'profile-photos');

CREATE POLICY "profile-photos update owner"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'profile-photos' AND owner = auth.uid());

CREATE POLICY "profile-photos delete owner"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'profile-photos' AND owner = auth.uid());

CREATE POLICY "profile-photos select public"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'profile-photos');
