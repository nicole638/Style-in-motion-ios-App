-- Creator measurements + algorithmic body-type derivation + curator-self
-- override tags. All raw measurements are private (creator-only via the
-- existing creator-own SELECT policy on creator_profiles); only the
-- derived/blended tags are exposed publicly via creator_profiles_public.
--
-- Sizes are stored as free text on purpose (US sizing is messy across
-- categories). Canonical units are metric (height_cm, weight_kg) so
-- height/weight comparisons across creators are unit-stable; the
-- measurement_unit field is purely a display preference.

-- 1. Add measurement columns -----------------------------------------------
alter table public.creator_profiles
  add column if not exists height_cm           int
    check (height_cm is null or height_cm between 100 and 230),
  add column if not exists weight_kg           numeric(5,2)
    check (weight_kg is null or weight_kg between 30 and 250),
  add column if not exists measurement_unit    text default 'us'
    check (measurement_unit in ('us','metric')),
  add column if not exists top_size            text,
  add column if not exists bottom_size         text,
  add column if not exists dress_size          text,
  add column if not exists shoe_size           text,
  add column if not exists bra_size            text,
  add column if not exists brand_size_examples jsonb default '[]'::jsonb,
  add column if not exists body_type_self_tags text[] default array[]::text[],
  add column if not exists profile_completed_at timestamptz;

-- 2. Algorithmic body-type derivation function ----------------------------
-- Returns an array of derived tags from height + size data. Tags chosen to
-- match how shoppers actually search:
--   height: 'petite' (≤160cm / ~5'3"), 'tall' (≥175cm / ~5'9"), 'average-height'
--   size:   'plus' (XL+/dress 14+), 'midsize' (dress 8-12), 'straight' (XS-L/dress 0-6)
-- Returns array minus any nulls so callers can union with self-tags.
create or replace function public.derive_body_type_tags(
  p_height_cm int,
  p_top_size  text,
  p_dress_size text
) returns text[]
language sql
immutable
as $$
  select array_remove(array[
    case
      when p_height_cm is null then null
      when p_height_cm <= 160 then 'petite'
      when p_height_cm >= 175 then 'tall'
      else 'average-height'
    end,
    case
      when upper(coalesce(p_top_size,'')) in ('XL','XXL','1X','2X','3X','4X','5X') then 'plus'
      when upper(coalesce(p_top_size,'')) in ('XS','S','M','L') then 'straight'
      when p_dress_size ~ '^[0-9]+$' and p_dress_size::int >= 14 then 'plus'
      when p_dress_size ~ '^[0-9]+$' and p_dress_size::int between 8 and 12 then 'midsize'
      when p_dress_size ~ '^[0-9]+$' and p_dress_size::int between 0 and 6 then 'straight'
      else null
    end
  ], null);
$$;

-- 3. Public-facing view exposing derived + self tags (NOT raw measurements)
-- Drop+recreate so we can add the new column. View depends on creator_profiles
-- so we use create or replace with column-compatible signature.
drop view if exists public.creator_profiles_public cascade;
create view public.creator_profiles_public as
select
  cp.creator_id,
  cp.username,
  cp.bio,
  cp.photo_url,
  cp.caption_style,
  cp.include_hashtags,
  cp.include_prices,
  cp.instagram_handle,
  cp.tiktok_handle,
  cp.youtube_handle,
  cp.pinterest_handle,
  cp.instagram_enabled,
  cp.tiktok_enabled,
  cp.youtube_enabled,
  cp.pinterest_enabled,
  cp.follower_count,
  cp.location,
  cp.is_beta_creator,
  -- Combined derived + self tags, deduplicated, public-safe (no raw sizes)
  (
    select coalesce(array_agg(distinct tag), array[]::text[])
    from unnest(
      coalesce(public.derive_body_type_tags(cp.height_cm, cp.top_size, cp.dress_size), array[]::text[])
      || coalesce(cp.body_type_self_tags, array[]::text[])
    ) as tag
    where tag is not null and tag <> ''
  ) as body_type_tags
from public.creator_profiles cp;

grant select on public.creator_profiles_public to anon, authenticated;

-- 4. Index to support fast filtering by body type tag in shopper feed.
-- Postgres can use a GIN index on the array directly via the && / @> operators.
-- We index the underlying array sources rather than the view since views
-- aren't directly indexable.
create index if not exists creator_profiles_self_tags_gin
  on public.creator_profiles using gin (body_type_self_tags);

-- 5. Convenience helper view: per-creator profile completion %, used by the
-- "Drafts (N)" / "Complete your profile" prompts in the mobile app.
create or replace view public.creator_profiles_completion as
select
  cp.creator_id,
  -- Each filled field counts equally toward completion (8 fields).
  (
    (case when length(coalesce(cp.bio,'')) >= 20 then 1 else 0 end)
    + (case when cp.photo_url is not null and cp.photo_url <> '' then 1 else 0 end)
    + (case when cp.instagram_handle is not null and cp.instagram_handle <> '' then 1 else 0 end)
    + (case when cp.height_cm is not null then 1 else 0 end)
    + (case when cp.top_size is not null and cp.top_size <> '' then 1 else 0 end)
    + (case when cp.bottom_size is not null and cp.bottom_size <> '' then 1 else 0 end)
    + (case when cp.shoe_size is not null and cp.shoe_size <> '' then 1 else 0 end)
    + (case when array_length(cp.body_type_self_tags, 1) > 0 then 1 else 0 end)
  ) * 100 / 8 as completion_pct,
  cp.profile_completed_at
from public.creator_profiles cp;

grant select on public.creator_profiles_completion to authenticated;
