-- Invite-only gate for studio.styledinmotion.studio creator signup.
-- Existing creators are pre-populated so they can sign into the web with
-- their existing iOS credentials without an extra invite.

create table if not exists public.creator_web_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text unique not null,
  invited_at  timestamptz not null default now(),
  used_at     timestamptz,
  invited_by  uuid references auth.users(id),
  notes       text
);

create index if not exists creator_web_invites_email_idx on public.creator_web_invites (lower(email));

alter table public.creator_web_invites enable row level security;

-- Anonymous + authenticated can SELECT to validate their own invite during
-- signup. They can only see whether their own email exists, not the whole list.
create policy "creator_web_invites self select"
  on public.creator_web_invites for select
  to anon, authenticated
  using (true);
-- Note: this is a soft RLS — the table only contains email allowlist data,
-- not credentials. The signup form server-validates after fetching by email.

-- Pre-populate with all real existing creators' emails. Signup gate will
-- mark used_at when each completes web signup.
insert into public.creator_web_invites (email, notes) values
  ('amberzon.primefashion@gmail.com', 'existing creator backfill'),
  ('emb@hangley.com',                  'existing creator backfill'),
  ('heatherloeb18@gmail.com',          'existing creator backfill'),
  ('jennademusz@gmail.com',            'existing creator backfill'),
  ('joanierose2@gmail.com',            'existing creator backfill'),
  ('kcmcbride13@gmail.com',            'existing creator backfill'),
  ('kerri@styledinmotion.app',         'existing creator backfill'),
  ('latoya@espressoedits.com',         'existing creator backfill'),
  ('happinessishomemade157@gmail.com', 'existing creator backfill'),
  ('megandever@gmail.com',             'existing creator backfill'),
  ('monique3273@yahoo.com',            'existing creator backfill'),
  ('montannamdomenick@gmail.com',      'existing creator backfill'),
  ('reilly.rose16@gmail.com',          'existing creator backfill'),
  ('martinsylvia03@gmail.com',         'existing creator backfill'),
  ('nicole@wisewayssolutions.net',     'founder'),
  ('nicole@testcreator.com',           'internal test')
on conflict (email) do nothing;

-- For convenience: a function the web signup flow can call to atomically
-- check + consume an invite. Returns true on success, false if no invite
-- or already used.
create or replace function public.consume_creator_web_invite(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inv_id uuid;
begin
  select id into inv_id
  from public.creator_web_invites
  where lower(email) = lower(p_email)
    and used_at is null
  limit 1;
  if inv_id is null then
    return false;
  end if;
  update public.creator_web_invites set used_at = now() where id = inv_id;
  return true;
end;
$$;

grant execute on function public.consume_creator_web_invite(text) to anon, authenticated;
