-- ────────────────────────────────────────────────────────────────────────────
-- Brand storefronts v1 — full schema for the Golden Bear Garage launch.
-- Companion design docs:
--   docs/golden-bear-collab-design.md
--   docs/partner-brand-access-and-stylist-login.md
--
-- Applied to prod via Supabase MCP on 2026-06-05; this file mirrors it for
-- version control. The platform git-reset risk means the *durable* record of
-- this migration is in the Supabase migrations history table; this repo file
-- is for human reference + future fresh-environment bootstraps.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Tag creator_profiles by account type. Humans default to 'creator';
--    brand storefront content accounts use 'partner_brand'.
alter table public.creator_profiles
  add column if not exists account_type text not null default 'creator';
do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'creator_profiles_account_type_check'
  ) then
    alter table public.creator_profiles
      add constraint creator_profiles_account_type_check
      check (account_type in ('creator', 'partner_brand'));
  end if;
end $$;

-- 2. Global admin flag (Nicole + Kerri = founders today). The /admin web
--    section reads this. Ship the column now so the admin UI gates cleanly.
alter table public.creator_profiles
  add column if not exists is_admin boolean not null default false;

-- 3. Brand storefronts — the business record (persistent; distinct from
--    sponsored-gig brand_partnerships).
create table if not exists public.brand_storefronts (
  id                     uuid primary key default gen_random_uuid(),
  storefront_creator_id  uuid not null references public.creator_profiles(creator_id) on delete cascade,
  name                   text not null,
  slug                   text not null unique,
  brand_story            text,
  logo_url               text,
  commission_pct         numeric not null default 15
                           check (commission_pct >= 0 and commission_pct <= 100),
  promo_code             text,
  fulfillment            jsonb not null default '[]'::jsonb
                           check (jsonb_typeof(fulfillment) = 'array'),
  contact_email          text,
  status                 text not null default 'active'
                           check (status in ('active', 'paused', 'archived')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists brand_storefronts_storefront_creator_id_idx
  on public.brand_storefronts(storefront_creator_id);

-- 4. Memberships — many-to-many between humans and brands carrying a role.
--    'analyst' included from day one (view-only audiences: investor, accountant).
create table if not exists public.brand_memberships (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references public.creator_profiles(creator_id) on delete cascade,
  brand_id      uuid not null references public.brand_storefronts(id) on delete cascade,
  role          text not null check (role in ('owner', 'stylist', 'analyst')),
  status        text not null default 'active'
                  check (status in ('active', 'paused', 'revoked')),
  assigned_by   uuid references public.creator_profiles(creator_id),
  assigned_at   timestamptz not null default now(),
  unique (creator_id, brand_id)
);
create index if not exists brand_memberships_creator_id_idx on public.brand_memberships(creator_id);
create index if not exists brand_memberships_brand_id_idx   on public.brand_memberships(brand_id);

-- 5. authored_by — credit the human who built a brand row even though
--    creator_id is the storefront. Powers per-stylist analytics later.
alter table public.looks         add column if not exists authored_by uuid references public.creator_profiles(creator_id) on delete set null;
alter table public.creator_items add column if not exists authored_by uuid references public.creator_profiles(creator_id) on delete set null;

-- ────────────────────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────────────────────

alter table public.brand_storefronts enable row level security;
alter table public.brand_memberships enable row level security;

create policy brand_storefronts_select_public on public.brand_storefronts
  for select using (status = 'active');

create policy brand_storefronts_select_members on public.brand_storefronts
  for select using (
    exists (
      select 1 from public.brand_memberships m
       where m.brand_id = brand_storefronts.id
         and m.creator_id = auth.uid()
         and m.status = 'active'
    )
  );

create policy brand_storefronts_admin_all on public.brand_storefronts
  for all using (
    exists (select 1 from public.creator_profiles cp
              where cp.creator_id = auth.uid() and cp.is_admin = true)
  )
  with check (
    exists (select 1 from public.creator_profiles cp
              where cp.creator_id = auth.uid() and cp.is_admin = true)
  );

create policy brand_memberships_select_self on public.brand_memberships
  for select using (creator_id = auth.uid());

create policy brand_memberships_admin_all on public.brand_memberships
  for all using (
    exists (select 1 from public.creator_profiles cp
              where cp.creator_id = auth.uid() and cp.is_admin = true)
  )
  with check (
    exists (select 1 from public.creator_profiles cp
              where cp.creator_id = auth.uid() and cp.is_admin = true)
  );

-- looks: stylists can view + write looks belonging to brands they stylist for.
create policy looks_select_storefront_members on public.looks
  for select using (
    exists (
      select 1 from public.brand_memberships m
        join public.brand_storefronts bs on bs.id = m.brand_id
       where m.creator_id = auth.uid()
         and m.status = 'active'
         and bs.storefront_creator_id = looks.creator_id
    )
  );

create policy looks_insert_storefront_stylist on public.looks
  for insert with check (
    exists (
      select 1 from public.brand_memberships m
        join public.brand_storefronts bs on bs.id = m.brand_id
       where m.creator_id = auth.uid()
         and m.status = 'active'
         and m.role = 'stylist'
         and bs.storefront_creator_id = looks.creator_id
    )
  );

create policy looks_update_storefront_stylist on public.looks
  for update using (
    exists (
      select 1 from public.brand_memberships m
        join public.brand_storefronts bs on bs.id = m.brand_id
       where m.creator_id = auth.uid()
         and m.status = 'active'
         and m.role = 'stylist'
         and bs.storefront_creator_id = looks.creator_id
    )
  );

create policy looks_delete_storefront_stylist on public.looks
  for delete using (
    exists (
      select 1 from public.brand_memberships m
        join public.brand_storefronts bs on bs.id = m.brand_id
       where m.creator_id = auth.uid()
         and m.status = 'active'
         and m.role = 'stylist'
         and bs.storefront_creator_id = looks.creator_id
    )
  );

-- creator_items writes for stylists in storefront context.
create policy creator_items_insert_storefront_stylist on public.creator_items
  for insert with check (
    exists (
      select 1 from public.brand_memberships m
        join public.brand_storefronts bs on bs.id = m.brand_id
       where m.creator_id = auth.uid()
         and m.status = 'active'
         and m.role = 'stylist'
         and bs.storefront_creator_id = creator_items.creator_id
    )
  );

create policy creator_items_update_storefront_stylist on public.creator_items
  for update using (
    exists (
      select 1 from public.brand_memberships m
        join public.brand_storefronts bs on bs.id = m.brand_id
       where m.creator_id = auth.uid()
         and m.status = 'active'
         and m.role = 'stylist'
         and bs.storefront_creator_id = creator_items.creator_id
    )
  );

create policy creator_items_delete_storefront_stylist on public.creator_items
  for delete using (
    exists (
      select 1 from public.brand_memberships m
        join public.brand_storefronts bs on bs.id = m.brand_id
       where m.creator_id = auth.uid()
         and m.status = 'active'
         and m.role = 'stylist'
         and bs.storefront_creator_id = creator_items.creator_id
    )
  );

create or replace function public.touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists brand_storefronts_touch on public.brand_storefronts;
create trigger brand_storefronts_touch
  before update on public.brand_storefronts
  for each row execute function public.touch_updated_at();
