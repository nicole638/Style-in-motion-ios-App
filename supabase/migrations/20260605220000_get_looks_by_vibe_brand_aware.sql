-- Extend get_looks_by_vibe RPC with brand-storefront identity so the public
-- discover feed can render brand byline (logo + brand name) when a look's
-- creator is a partner_brand account. Companion to mobile feed.tsx changes
-- in CHANGES.md §6f.
--
-- Applied to prod via Supabase MCP on 2026-06-05; mirrored here for VCS.
-- DROP first because CREATE OR REPLACE cannot change return-type shape.

drop function if exists public.get_looks_by_vibe(text[], text[], text[], text[], text[], text, integer, integer);

create function public.get_looks_by_vibe(
  p_style text[] default null::text[],
  p_occasion text[] default null::text[],
  p_season text[] default null::text[],
  p_color text[] default null::text[],
  p_clothing_type text[] default null::text[],
  p_search text default null::text,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  look_id uuid,
  creator_id uuid,
  creator_name text,
  creator_username text,
  creator_photo_url text,
  creator_handle text,
  title text,
  caption text,
  cover_photo_url text,
  short_code text,
  style_vibe text[],
  occasion text[],
  season text[],
  color_palette text[],
  clothing_type text[],
  creator_tags text[],
  hashtags text[],
  likes_count integer,
  clicks integer,
  published_at timestamptz,
  match_score integer,
  account_type text,
  brand_name text,
  brand_slug text,
  brand_logo_url text
)
language sql
stable
as $function$
  with ranked as (
    select
      l.id as look_id, l.creator_id,
      (c.first_name || coalesce(' ' || c.last_name, '')) as creator_name,
      cp.username as creator_username,
      cp.photo_url as creator_photo_url,
      cp.instagram_handle as creator_handle,
      l.title, l.caption, l.cover_photo_url, l.short_code,
      l.style_vibe, l.occasion, l.season, l.color_palette, l.clothing_type,
      l.creator_tags, l.hashtags, l.likes_count, l.clicks, l.published_at,
      (
        (case when p_style is null or l.style_vibe && p_style then 1 else 0 end) +
        (case when p_occasion is null or l.occasion && p_occasion then 1 else 0 end) +
        (case when p_season is null or l.season && p_season then 1 else 0 end) +
        (case when p_color is null or l.color_palette && p_color then 1 else 0 end) +
        (case when p_clothing_type is null or l.clothing_type && p_clothing_type then 1 else 0 end)
      ) as match_score,
      cp.account_type,
      bs.name as brand_name,
      bs.slug as brand_slug,
      bs.logo_url as brand_logo_url
    from looks l
    join creators c on c.id = l.creator_id
    left join creator_profiles cp on cp.creator_id = l.creator_id
    left join brand_storefronts bs
           on bs.storefront_creator_id = l.creator_id
          and bs.status = 'active'
    where l.archived = false
      and l.published_at is not null
      and l.cover_photo_url is not null
      and (p_style is null or l.style_vibe && p_style)
      and (p_occasion is null or l.occasion && p_occasion)
      and (p_season is null or l.season && p_season)
      and (p_color is null or l.color_palette && p_color)
      and (p_clothing_type is null or l.clothing_type && p_clothing_type)
      and (
        p_search is null
        or l.title ilike '%' || p_search || '%'
        or l.caption ilike '%' || p_search || '%'
        or exists (select 1 from unnest(l.creator_tags) t where t ilike '%' || p_search || '%')
        or exists (select 1 from unnest(l.hashtags) h where h ilike '%' || p_search || '%')
      )
  )
  select look_id, creator_id, creator_name, creator_username, creator_photo_url,
         creator_handle, title, caption, cover_photo_url, short_code,
         style_vibe, occasion, season, color_palette, clothing_type,
         creator_tags, hashtags, likes_count, clicks, published_at, match_score,
         account_type, brand_name, brand_slug, brand_logo_url
  from ranked
  order by match_score desc, published_at desc nulls last, likes_count desc nulls last
  limit p_limit offset p_offset;
$function$;

grant execute on function public.get_looks_by_vibe(text[],text[],text[],text[],text[],text,integer,integer) to anon, authenticated;
