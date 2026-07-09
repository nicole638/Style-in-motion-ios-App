-- The BEFORE UPDATE trigger added in vto_phase1_followups was meant to
-- restrict authenticated users to updating only `saved_at`. But the
-- edge function (running under service_role) needs to update status,
-- error, output_url, completed_at when finalizing a render. The
-- previous JWT-claims null check did not reliably distinguish service
-- role from authenticated callers, so the trigger was blocking the
-- edge function and leaving every render stuck at status='pending'.
--
-- Switch to auth.role() which Supabase guarantees returns
-- 'service_role' for service-key-authenticated calls regardless of
-- whether downstream JWT claims are set.

create or replace function public.vto_renders_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role bypasses the column guard entirely (used by the
  -- photoroom-edit edge function to finalize renders).
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Authenticated users may only change saved_at. All other columns
  -- must match OLD.
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
