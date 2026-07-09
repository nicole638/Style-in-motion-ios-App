-- VTO Phase 1: render history, backdrop presets, daily quota, render cache
-- Shared by shopper VTO (#16) and creator selfie background swap (#15).

-- 1. vto_renders — every Photoroom call from a user
create table if not exists public.vto_renders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('vto', 'remove_bg', 'swap_bg')),
  -- Inputs
  garment_url text,           -- VTO: the collage/cutout used as garment
  selfie_url text,            -- VTO: shopper's selfie (custom model image)
  source_url text,            -- bg-swap: source image (creator look)
  backdrop_id uuid,           -- bg-swap: preset chosen (nullable for remove_bg)
  -- Outputs
  output_url text,            -- public URL of result (when status='complete')
  status text not null default 'pending'
    check (status in ('pending','complete','failed','cached')),
  error text,
  -- Metadata
  cost_cents int default 10,
  cache_key text,             -- sha256(mode|garment|selfie|backdrop) for dedup
  look_id uuid,               -- optional link to look being tried on
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists vto_renders_user_idx on public.vto_renders(user_id, created_at desc);
create index if not exists vto_renders_cache_idx on public.vto_renders(cache_key) where cache_key is not null;
create index if not exists vto_renders_look_idx on public.vto_renders(look_id) where look_id is not null;

alter table public.vto_renders enable row level security;

-- Users see their own renders only
create policy "vto_renders own select" on public.vto_renders
  for select to authenticated using (user_id = auth.uid());

create policy "vto_renders own insert" on public.vto_renders
  for insert to authenticated with check (user_id = auth.uid());

-- 2. creator_backdrops — admin-curated preset backgrounds for selfie swap
create table if not exists public.creator_backdrops (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- "Beach Sunset", "City Loft", etc.
  category text,                      -- "outdoor", "studio", "lifestyle"
  image_url text not null,            -- full-res backdrop
  thumbnail_url text,                 -- 256px thumb for picker grid
  sort_order int default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists creator_backdrops_active_idx on public.creator_backdrops(active, sort_order);

alter table public.creator_backdrops enable row level security;

-- Anyone authenticated can read active backdrops
create policy "creator_backdrops public read" on public.creator_backdrops
  for select to authenticated using (active = true);

-- 3. render_quota — daily cap to prevent runaway Photoroom spend
create table if not exists public.render_quota (
  user_id uuid not null references auth.users(id) on delete cascade,
  day_bucket date not null default current_date,
  count int not null default 0,
  last_render_at timestamptz not null default now(),
  primary key (user_id, day_bucket)
);

alter table public.render_quota enable row level security;

create policy "render_quota own select" on public.render_quota
  for select to authenticated using (user_id = auth.uid());
-- Writes happen server-side via service role only; no insert/update policies for users.

-- 4. Helper function the edge function will call to atomically check + bump quota
create or replace function public.consume_render_quota(p_user_id uuid, p_daily_cap int default 20)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count int;
begin
  insert into public.render_quota (user_id, day_bucket, count, last_render_at)
  values (p_user_id, current_date, 1, now())
  on conflict (user_id, day_bucket)
  do update set count = render_quota.count + 1, last_render_at = now()
  returning count into current_count;

  if current_count > p_daily_cap then
    -- Roll back the bump
    update public.render_quota
       set count = current_count - 1
     where user_id = p_user_id and day_bucket = current_date;
    return false;
  end if;
  return true;
end;
$$;

grant execute on function public.consume_render_quota(uuid, int) to service_role;
