-- Per-creator analytics RPCs for Pass 2 stats (item rank + network mix).
--
-- Both functions are SECURITY DEFINER so the cross-table joins
-- (creator_items × click_events × look_items × commissions) bypass RLS,
-- AND defensively gate via `auth.uid() = p_creator_id` inside the WHERE
-- clauses so an authenticated user can only ever read their own analytics.
--
-- Used by:
--   - web /earnings "Traffic by network" + "Performance by item" sections
--   - iOS creator-analytics.tsx "Top Items" + "Traffic by Network" sections
--
-- Applied to prod via Supabase MCP on 2026-06-08; mirrored here for VCS.

create or replace function public.creator_item_performance(p_creator_id uuid)
returns table (
  item_id          uuid,
  name             text,
  brand            text,
  category         text,
  photo_url        text,
  clicks           int,
  looks_count      int,
  earnings_usd     numeric,
  commission_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with
  item_clicks as (
    select ce.item_id, count(*)::int as click_count
      from public.click_events ce
     where ce.creator_id = p_creator_id
       and ce.is_test_burst = false
       and ce.item_id is not null
     group by ce.item_id
  ),
  item_looks as (
    select li.creator_item_id as item_id,
           count(distinct li.look_id)::int as looks_count
      from public.look_items li
      join public.creator_items ci on ci.id = li.creator_item_id
     where ci.creator_id = p_creator_id
     group by li.creator_item_id
  ),
  item_earnings as (
    select ce.item_id,
           coalesce(sum(c.creator_share), 0)::numeric as earnings,
           count(distinct c.id)::int as commission_count
      from public.commissions c
      join public.click_events ce on ce.id = c.click_event_id
     where c.creator_id = p_creator_id
       and c.status in ('confirmed','paid')
       and ce.item_id is not null
     group by ce.item_id
  )
  select
    ci.id            as item_id,
    ci.name,
    ci.brand,
    ci.category,
    ci.photo_url,
    coalesce(ic.click_count, 0)      as clicks,
    coalesce(il.looks_count, 0)      as looks_count,
    coalesce(ie.earnings, 0)         as earnings_usd,
    coalesce(ie.commission_count, 0) as commission_count
    from public.creator_items ci
    left join item_clicks   ic on ic.item_id = ci.id
    left join item_looks    il on il.item_id = ci.id
    left join item_earnings ie on ie.item_id = ci.id
   where ci.creator_id = p_creator_id
     and ci.creator_id = auth.uid()
     and (ci.archived = false or ci.archived is null)
   order by clicks desc, earnings_usd desc, ci.name asc;
$$;

revoke all on function public.creator_item_performance(uuid) from public;
grant execute on function public.creator_item_performance(uuid) to authenticated;

create or replace function public.creator_clicks_by_network(p_creator_id uuid)
returns table (
  network          text,
  clicks           int,
  earnings_usd     numeric,
  commission_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with click_buckets as (
    select coalesce(affiliate_network, 'unaffiliated') as network,
           id
      from public.click_events
     where creator_id = p_creator_id
       and is_test_burst = false
       and creator_id = auth.uid()
  ),
  click_counts as (
    select network, count(*)::int as click_count
      from click_buckets
     group by network
  ),
  network_earnings as (
    select coalesce(c.affiliate_network, 'unaffiliated') as network,
           coalesce(sum(c.creator_share), 0)::numeric as earnings,
           count(distinct c.id)::int as commission_count
      from public.commissions c
     where c.creator_id = p_creator_id
       and c.status in ('confirmed','paid')
     group by coalesce(c.affiliate_network, 'unaffiliated')
  )
  select
    cc.network,
    cc.click_count                     as clicks,
    coalesce(ne.earnings, 0)           as earnings_usd,
    coalesce(ne.commission_count, 0)   as commission_count
    from click_counts cc
    left join network_earnings ne on ne.network = cc.network
   order by clicks desc, earnings_usd desc;
$$;

revoke all on function public.creator_clicks_by_network(uuid) from public;
grant execute on function public.creator_clicks_by_network(uuid) to authenticated;
