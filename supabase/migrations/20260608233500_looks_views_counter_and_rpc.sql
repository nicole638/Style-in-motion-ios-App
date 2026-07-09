-- Look-view counter — atomic per-look impressions counter mirroring the
-- existing `clicks` column + `increment_look_clicks` RPC.
--
-- Why DB-backed: iOS analyticsStore.lookViews was Zustand-only (per-device).
-- Shoppers' views were tracked on their own devices, never reaching the
-- creator dashboard. Creator-stats.tsx showed `0 Look Views` permanently
-- even when real shoppers opened the looks. Switching to a DB-backed
-- counter — incremented from ItemListSheet useEffect on every sheet open —
-- closes the cross-device aggregation gap.
--
-- RPC is SECURITY DEFINER so anon shoppers can call it without RLS on the
-- looks table letting them write. Mirrors the increment_look_clicks RPC
-- (migration 20260524210000).
--
-- Applied to prod via Supabase MCP on 2026-06-08; mirrored here for VCS.

alter table public.looks
  add column if not exists views integer not null default 0;

create or replace function public.increment_look_views(p_look_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.looks
     set views = coalesce(views, 0) + 1
   where id = p_look_id;
end;
$$;

revoke all on function public.increment_look_views(uuid) from public;
grant execute on function public.increment_look_views(uuid) to anon, authenticated;
