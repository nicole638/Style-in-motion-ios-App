-- ensurePublicPhotoUrl in mobile/src/lib/api/vto.ts uploads creator
-- source photos to cutouts/look-photos/<auth.uid()>/<sha>.jpg before
-- handing the public URL to the photoroom-edit edge function. The
-- existing storage policies only allowed selfies/<uid>/*, so creator
-- backdrop swap and remove-bg were silently 403'ing on upload. Add
-- the matching policies for the look-photos subfolder.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='cutouts look-photos insert own'
  ) then
    create policy "cutouts look-photos insert own"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'cutouts'
        and (storage.foldername(name))[1] = 'look-photos'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='cutouts look-photos update own'
  ) then
    create policy "cutouts look-photos update own"
      on storage.objects for update
      to authenticated
      using (
        bucket_id = 'cutouts'
        and (storage.foldername(name))[1] = 'look-photos'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='cutouts look-photos delete own'
  ) then
    create policy "cutouts look-photos delete own"
      on storage.objects for delete
      to authenticated
      using (
        bucket_id = 'cutouts'
        and (storage.foldername(name))[1] = 'look-photos'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;
