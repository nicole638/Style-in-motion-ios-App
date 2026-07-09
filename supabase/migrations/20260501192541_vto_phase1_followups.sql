-- Followups for VTO Phase 1 after first mobile build:
--   1) storage policies for cutouts bucket (selfie uploads + reads)
--   2) saved_at column on vto_renders + matching UPDATE policy
--      so "Save to Gallery" persists server-side instead of in local store.

-- 1. Storage policies for cutouts bucket -------------------------------

-- Public SELECT: bucket is already public, but having an explicit policy
-- avoids surprises and matches the pattern other buckets use.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='cutouts select public'
  ) then
    create policy "cutouts select public"
      on storage.objects for select
      to public
      using (bucket_id = 'cutouts');
  end if;
end $$;

-- Authenticated INSERT — locked to selfies/<auth.uid()>/* path so users
-- can't pollute other folders (cutouts/, backdrops/, vto-renders/).
-- Service role uploads (edge function, scripts) bypass RLS so admin paths
-- continue to work.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='cutouts selfie insert own'
  ) then
    create policy "cutouts selfie insert own"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'cutouts'
        and (storage.foldername(name))[1] = 'selfies'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;

-- Authenticated UPDATE — same path lock (Vibecode upload uses upsert,
-- so re-uploading the same content-addressed file becomes an UPDATE).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='cutouts selfie update own'
  ) then
    create policy "cutouts selfie update own"
      on storage.objects for update
      to authenticated
      using (
        bucket_id = 'cutouts'
        and (storage.foldername(name))[1] = 'selfies'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;

-- Authenticated DELETE — users can purge their own selfies.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='cutouts selfie delete own'
  ) then
    create policy "cutouts selfie delete own"
      on storage.objects for delete
      to authenticated
      using (
        bucket_id = 'cutouts'
        and (storage.foldername(name))[1] = 'selfies'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end $$;

-- 2. saved_at column + UPDATE policy on vto_renders --------------------

alter table public.vto_renders
  add column if not exists saved_at timestamptz;

create index if not exists vto_renders_saved_idx
  on public.vto_renders(user_id, saved_at desc)
  where saved_at is not null;

-- Only allow users to UPDATE their own rows, and only saved_at can change.
-- This is a column-level guard via row trigger (RLS UPDATE policies can't
-- restrict columns in Postgres, so we use a BEFORE UPDATE trigger).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='vto_renders'
      and policyname='vto_renders own update saved'
  ) then
    create policy "vto_renders own update saved"
      on public.vto_renders for update
      to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

create or replace function public.vto_renders_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role bypasses RLS; let it through unchanged.
  if current_setting('request.jwt.claims', true) is null then
    return new;
  end if;

  -- Only saved_at may differ. All other columns must match OLD.
  if new.id           is distinct from old.id
  or new.user_id      is distinct from old.user_id
  or new.mode         is distinct from old.mode
  or new.garment_url  is distinct from old.garment_url
  or new.selfie_url   is distinct from old.selfie_url
  or new.source_url   is distinct from old.source_url
  or new.backdrop_id  is distinct from old.backdrop_id
  or new.output_url   is distinct from old.output_url
  or new.status       is distinct from old.status
  or new.error        is distinct from old.error
  or new.cost_cents   is distinct from old.cost_cents
  or new.cache_key    is distinct from old.cache_key
  or new.look_id      is distinct from old.look_id
  or new.created_at   is distinct from old.created_at
  or new.completed_at is distinct from old.completed_at
  then
    raise exception 'vto_renders: only saved_at may be updated by users';
  end if;
  return new;
end;
$$;

drop trigger if exists vto_renders_guard_update_trg on public.vto_renders;
create trigger vto_renders_guard_update_trg
  before update on public.vto_renders
  for each row execute function public.vto_renders_guard_update();
