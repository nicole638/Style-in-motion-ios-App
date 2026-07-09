-- ────────────────────────────────────────────────────────────────────────────
-- share_beacon — runtime diagnostic beacon for the "Share → Styled in Motion"
-- extension hand-off.
--
-- Why this exists: builds that PROVABLY contain every share-extension fix still
-- fail on-device (fresh share_device_tokens rows with last_used_at = null →
-- share-add-item never redeemed). Nicole can't read device logs, so we need a
-- server-visible signal from BOTH sides of the App Group hand-off to see reality
-- instead of reasoning about it:
--
--   side = 'app'  — written by mobile/src/lib/share/deviceToken.ts when it
--                   mirrors the token: is NativeModules.SimSharedDefaults present
--                   at runtime (module_present) and did the write return
--                   (write_returned)?  Answers "does the WRITE path even run?"
--   side = 'ext'  — written by ShareExtension/ShareViewController.swift on every
--                   share: can the extension resolve the App Group container
--                   (container_reachable — proves the entitlement/provisioning
--                   actually granted the group at runtime) and did it find a
--                   value for sim_share_token (token_found)?  Answers "does the
--                   READ path see what the app wrote?"
--
-- Discriminator table (read via GET /api/share-beacon/recent):
--   ext.container_reachable = false                    → extension's App Group
--     entitlement/provisioning stripped at signing (the last unverifiable-from-
--     source suspect).
--   app.write_returned = true, ext.container_reachable = true, token_found=false
--     → app and extension resolve DIFFERENT containers (app-group registration
--     mismatch) or the OS purged the value.
--   app.module_present = false                          → native module still
--     absent at runtime (bridgeless) — the TurboModuleRegistry fix didn't cover
--     this path.
--
-- Writable by anon (the extension holds only the anon key) AND authenticated
-- (the app mirrors while a creator session is active). Never read back by those
-- roles — only the service-role backend endpoint selects. Diagnostic-only; can
-- be dropped once the share hand-off is confirmed working end-to-end.
--
-- Idempotent: safe to re-run.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.share_beacon (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  side                text not null check (side in ('app', 'ext')),
  suite               text,
  module_present      boolean,
  write_returned      boolean,
  container_reachable boolean,
  token_found         boolean,
  app_version         text,
  build_number        text,
  note                text,
  extra               jsonb
);

create index if not exists share_beacon_created_at_idx
  on public.share_beacon (created_at desc);

alter table public.share_beacon enable row level security;

-- Insert-only for the client roles. `with check (true)` — this is an append-only
-- diagnostic sink; there is nothing sensitive to gate and both sides must be able
-- to write (extension = anon, app = authenticated).
drop policy if exists "share_beacon anon+authenticated insert" on public.share_beacon;
create policy "share_beacon anon+authenticated insert"
  on public.share_beacon
  for insert
  to anon, authenticated
  with check (true);

-- RLS governs row visibility; table privileges must still be granted explicitly.
grant insert on public.share_beacon to anon, authenticated;
