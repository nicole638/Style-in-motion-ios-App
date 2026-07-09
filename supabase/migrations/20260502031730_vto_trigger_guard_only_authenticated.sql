-- Tighten the guard: only restrict updates from auth.role() = 'authenticated'.
-- service_role, postgres admin, and any other role passes through.
-- (Previous version checked auth.role() = 'service_role' and let everything
-- else through, but admin SQL via the MCP runs as postgres which isn't
-- 'service_role' but also isn't 'authenticated' — this should bypass too.)

create or replace function public.vto_renders_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only authenticated users get the column-level guard. Everyone else
  -- (service_role from the edge function, postgres admin) passes.
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;

  if new.id           is distinct from old.id
  or new.user_id      is distinct from old.user_id
  or new.mode         is distinct from old.mode
  or new.garment_url  is distinct from old.garment_url
  or new.selfie_url   is distinct from old.selfie_url
  or new.source_url   is distinct from old.source_url
  or new.backdrop_id  is distinct from old.backdrop_id
  or new.output_url   is distinct from old.output_url
  or new.status       is distinct from old.status
  or new.error        is distinct from old.error
  or new.cost_cents   is distinct from old.cost_cents
  or new.cache_key    is distinct from old.cache_key
  or new.look_id      is distinct from old.look_id
  or new.created_at   is distinct from old.created_at
  or new.completed_at is distinct from old.completed_at
  then
    raise exception 'vto_renders: only saved_at may be updated by users';
  end if;
  return new;
end;
$$;
