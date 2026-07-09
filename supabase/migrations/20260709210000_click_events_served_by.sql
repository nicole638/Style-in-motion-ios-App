-- Adoption marker for the Vibecode decommission gate (migration plan Phase 4).
-- Rows written by the new shop-redirect EDGE function carry served_by='edge';
-- rows from the legacy Hono backend (old app builds hitting
-- meadow-grindstone.vibecode.run) stay NULL. When NULL rows stop arriving,
-- every installed app has updated and the legacy backend can be turned off.
alter table public.click_events add column if not exists served_by text;
