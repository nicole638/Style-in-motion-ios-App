-- Brand-catalog tap events pass look_id=null (no look context — e.g. a shopper
-- tapping a product directly from the brand page or starter catalog). The
-- previous WITH CHECK was:
--   EXISTS (SELECT 1 FROM looks l WHERE l.id = click_events.look_id AND l.archived = false)
-- which returns false when look_id is null, silently failing all brand-catalog
-- inserts via the mobile `logClickEvent` helper (the function wraps in
-- try/catch and just console.warn's, so the failure was invisible).
--
-- Loosen to allow null look_id while preserving the FK validation when look_id
-- IS provided. Look-bound rows still must reference a non-archived look.
-- Applied to prod via Supabase MCP on 2026-06-05; this file mirrors it for VCS.
alter policy "Anyone can log clicks" on public.click_events
  with check (
    click_events.look_id is null
    or exists (
      select 1
        from public.looks l
       where l.id = click_events.look_id
         and l.archived = false
    )
  );
