-- In-app follows — shopper → creator. Replaces the local-only Zustand follow
-- store so follows persist cross-device, drive a "Following" feed, and yield
-- a correct follower count on creator profiles.
--
-- Identity: follower_id = auth.uid() (the shopper's audience-account auth
-- user, or a creator browsing-as-shopper). creator_id = the followed
-- creator's creator_profiles.creator_id.
--
-- Applied to prod via Supabase MCP on 2026-06-09; mirrored here for VCS.

create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  creator_id  uuid not null references public.creator_profiles(creator_id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, creator_id)
);
create index if not exists follows_creator_id_idx on public.follows(creator_id);
create index if not exists follows_follower_id_idx on public.follows(follower_id);

alter table public.follows enable row level security;

create policy follows_select_own on public.follows
  for select using (follower_id = auth.uid());
create policy follows_insert_own on public.follows
  for insert with check (follower_id = auth.uid());
create policy follows_delete_own on public.follows
  for delete using (follower_id = auth.uid());

-- Denormalized in-app follower counter (distinct from the social-media
-- follower_count used for tiering). Public read via the existing
-- creator_profiles public SELECT policy.
alter table public.creator_profiles
  add column if not exists app_follower_count integer not null default 0;

create or replace function public.bump_app_follower_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.creator_profiles
       set app_follower_count = app_follower_count + 1
     where creator_id = new.creator_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.creator_profiles
       set app_follower_count = greatest(0, app_follower_count - 1)
     where creator_id = old.creator_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_bump_app_follower_count on public.follows;
create trigger trg_bump_app_follower_count
  after insert or delete on public.follows
  for each row execute function public.bump_app_follower_count();

-- get_following_feed — looks from creators the viewer follows. SAME column
-- shape as get_looks_by_vibe so the iOS DiscoverLookCard renders it
-- unchanged. SECURITY DEFINER; reads auth.uid() internally.
create or replace function public.get_following_feed(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  look_id uuid, creator_id uuid, creator_name text, creator_username text,
  creator_photo_url text, creator_handle text, title text, caption text,
  cover_photo_url text, short_code text, style_vibe text[], occasion text[],
  season text[], color_palette text[], clothing_type text[], creator_tags text[],
  hashtags text[], likes_count integer, clicks integer, published_at timestamptz,
  match_score integer, account_type text, brand_name text, brand_slug text,
  brand_logo_url text
)
language sql
stable
security definer
set search_path = public
as $function$
  select
    l.id as look_id, l.creator_id,
    (c.first_name || coalesce(' ' || c.last_name, '')) as creator_name,
    cp.username as creator_username,
    cp.photo_url as creator_photo_url,
    cp.instagram_handle as creator_handle,
    l.title, l.caption, l.cover_photo_url, l.short_code,
    l.style_vibe, l.occasion, l.season, l.color_palette, l.clothing_type,
    l.creator_tags, l.hashtags, l.likes_count, l.clicks, l.published_at,
    0 as match_score,
    cp.account_type, bs.name as brand_name, bs.slug as brand_slug,
    bs.logo_url as brand_logo_url
  from public.looks l
  join public.creators c on c.id = l.creator_id
  left join public.creator_profiles cp on cp.creator_id = l.creator_id
  left join public.brand_storefronts bs
         on bs.storefront_creator_id = l.creator_id and bs.status = 'active'
  where l.archived = false
    and l.published_at is not null
    and l.cover_photo_url is not null
    and l.creator_id in (
      select f.creator_id from public.follows f where f.follower_id = auth.uid()
    )
  order by l.published_at desc nulls last
  limit p_limit offset p_offset;
$function$;

grant execute on function public.get_following_feed(integer, integer) to anon, authenticated;
