-- Suggested creators for the "Creators to follow" rail. Real creators (NOT
-- partner-brand storefronts) with ≥1 published look, excluding the viewer and
-- anyone they already follow. Ranked by in-app followers desc, then published
-- look count. SECURITY DEFINER; reads auth.uid() for the exclude-my-follows
-- filter.
--
-- Applied to prod via Supabase MCP on 2026-06-09; mirrored here for VCS.
create or replace function public.get_suggested_creators(p_limit integer default 12)
returns table (
  creator_id           uuid,
  username             text,
  photo_url            text,
  app_follower_count   integer,
  published_look_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  with look_counts as (
    select l.creator_id, count(*)::int as n
      from public.looks l
     where l.archived = false and l.published_at is not null
     group by l.creator_id
  )
  select
    cp.creator_id, cp.username, cp.photo_url,
    cp.app_follower_count, lc.n as published_look_count
  from public.creator_profiles cp
  join look_counts lc on lc.creator_id = cp.creator_id
  where coalesce(cp.account_type, 'creator') = 'creator'
    and cp.creator_id <> auth.uid()
    and cp.creator_id not in (
      select f.creator_id from public.follows f where f.follower_id = auth.uid()
    )
  order by cp.app_follower_count desc, lc.n desc, cp.username asc
  limit p_limit;
$$;

grant execute on function public.get_suggested_creators(integer) to anon, authenticated;
