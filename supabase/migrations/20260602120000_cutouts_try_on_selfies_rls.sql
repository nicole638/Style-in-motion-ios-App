-- The Try-on Model sheet "Use my photo" tile (mobile/src/components/TryOnModelSheet.tsx)
-- uploads creator selfies via uploadTryOnSelfie() -> cutouts/try-on-selfies/<auth.uid()>/<sha>.jpg.
-- The existing cutouts policies only cover selfies/<uid>/* (shopper VTO) and
-- look-photos/<uid>/* (creator source photos), so try-on-selfies/* uploads were
-- silently 403'ing with "new row violates row-level security policy" — the
-- picker fired but no bytes ever landed in storage, model_custom_url stayed
-- null, and Generate fell back to whatever preset model was selected.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='cutouts try-on-selfies insert own'
  ) then
    create policy "cutouts try-on-selfies insert own"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'cutouts'
        and (storage.foldername(name))[1] = 'try-on-selfies'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='cutouts try-on-selfies update own'
  ) then
    create policy "cutouts try-on-selfies update own"
      on storage.objects for update
      to authenticated
      using (
        bucket_id = 'cutouts'
        and (storage.foldername(name))[1] = 'try-on-selfies'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='cutouts try-on-selfies delete own'
  ) then
    create policy "cutouts try-on-selfies delete own"
      on storage.objects for delete
      to authenticated
      using (
        bucket_id = 'cutouts'
        and (storage.foldername(name))[1] = 'try-on-selfies'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;
