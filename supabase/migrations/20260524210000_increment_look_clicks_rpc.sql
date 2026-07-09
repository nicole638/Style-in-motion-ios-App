-- Atomic click counter for looks. Replaces the client-side read-modify-write
-- (which lost increments under concurrency). SECURITY DEFINER so public audience
-- viewers (anon) can increment a look's click count regardless of looks RLS.
-- Applied to prod via Supabase MCP on 2026-05-24; this file mirrors it for VCS.
create or replace function public.increment_look_clicks(p_look_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.looks
     set clicks = coalesce(clicks, 0) + 1
   where id = p_look_id;
$$;

revoke all on function public.increment_look_clicks(uuid) from public;
grant execute on function public.increment_look_clicks(uuid) to anon, authenticated;
