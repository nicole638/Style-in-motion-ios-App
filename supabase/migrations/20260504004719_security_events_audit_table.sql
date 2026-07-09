-- Custom audit table for security-relevant events that Supabase's built-in
-- audit log either doesn't capture or prunes too aggressively. Triggered
-- writes from profile photo changes and storage uploads to profile-photos.

create table if not exists public.security_events (
  id           bigserial primary key,
  occurred_at  timestamptz not null default now(),
  event_type   text not null,                     -- 'profile_photo_changed', 'profile_photo_uploaded', 'creator_password_rotated', etc.
  actor_user_id uuid,                              -- auth.uid() at the time of the change (when available)
  target_user_id uuid,                             -- the user whose data was affected
  target_type  text,                               -- 'creator_profile', 'storage_object'
  details      jsonb not null default '{}'::jsonb, -- old/new values, paths, ip etc.
  source       text                                -- 'trigger_creator_profile' | 'trigger_storage_objects' | 'manual'
);

create index if not exists security_events_target_idx on public.security_events(target_user_id, occurred_at desc);
create index if not exists security_events_type_idx on public.security_events(event_type, occurred_at desc);

alter table public.security_events enable row level security;
-- No policies for non-service-role: authenticated/anon can't read or write.
-- Only service_role + admin (postgres) can query this table.

-- ──────────────────────────────────────────────────────────────────────
-- Trigger 1: log every change to creator_profiles.photo_url
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.log_creator_profile_photo_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.photo_url is distinct from old.photo_url) then
    insert into public.security_events (event_type, actor_user_id, target_user_id, target_type, details, source)
    values (
      'profile_photo_changed',
      auth.uid(),
      new.creator_id,
      'creator_profile',
      jsonb_build_object(
        'old_url', old.photo_url,
        'new_url', new.photo_url,
        'role', auth.role()
      ),
      'trigger_creator_profile'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists log_creator_profile_photo_change_trg on public.creator_profiles;
create trigger log_creator_profile_photo_change_trg
  after update on public.creator_profiles
  for each row execute function public.log_creator_profile_photo_change();

-- ──────────────────────────────────────────────────────────────────────
-- Trigger 2: log every upload/update to profile-photos bucket
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.log_profile_photo_storage_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  -- The path convention is <creator_uuid>/<filename>; extract uuid prefix.
  uid := nullif((string_to_array(new.name, '/'))[1], '')::uuid;

  insert into public.security_events (event_type, actor_user_id, target_user_id, target_type, details, source)
  values (
    case when tg_op = 'INSERT' then 'profile_photo_uploaded' else 'profile_photo_overwritten' end,
    auth.uid(),
    uid,
    'storage_object',
    jsonb_build_object(
      'path', new.name,
      'bucket', new.bucket_id,
      'size_bytes', (new.metadata->>'size'),
      'mime', (new.metadata->>'mimetype'),
      'owner_id', new.owner_id,
      'role', auth.role()
    ),
    'trigger_storage_objects'
  );
  return new;
exception when others then
  -- Never block storage writes if logging fails
  return new;
end;
$$;

drop trigger if exists log_profile_photo_storage_event_ins on storage.objects;
drop trigger if exists log_profile_photo_storage_event_upd on storage.objects;

create trigger log_profile_photo_storage_event_ins
  after insert on storage.objects
  for each row when (new.bucket_id = 'profile-photos')
  execute function public.log_profile_photo_storage_event();

create trigger log_profile_photo_storage_event_upd
  after update on storage.objects
  for each row when (new.bucket_id = 'profile-photos')
  execute function public.log_profile_photo_storage_event();

-- Seed an entry for the actual incident so the historical record exists
insert into public.security_events (occurred_at, event_type, actor_user_id, target_user_id, target_type, details, source)
values (
  '2026-05-02 12:23:43.622567+00',
  'profile_photo_overwritten',
  null,
  'a7a3c8e2-9683-4a3c-aa65-18c69b453ac7',
  'storage_object',
  jsonb_build_object(
    'path', 'a7a3c8e2-9683-4a3c-aa65-18c69b453ac7/profile.jpg',
    'bucket', 'profile-photos',
    'size_bytes', '448802',
    'mime', 'image/jpeg',
    'note', 'Pre-trigger backfill: photo overwritten by unknown actor authenticated as Zoe. Password rotated and sessions revoked 2026-05-04.'
  ),
  'manual'
);
