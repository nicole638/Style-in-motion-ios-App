-- Per-look size annotation: creator says what size they were wearing
-- in THIS specific look. Goes on look_items (the junction) so the same
-- item can be tagged at different sizes across looks (stretchy fit
-- between S and M, between events, etc.).
--
-- Stored as free text on purpose — sizes are messy across categories
-- (XS/S/M, 26/27/28, 6.5, 32B, 40R) and brand-specific. The mobile UI
-- will provide a contextual placeholder per item category but won't
-- gate the input.
--
-- Also persist a creator default on creator_items so they only have to
-- type their usual size once per closet item; the per-look override
-- still wins when set.

alter table public.look_items
  add column if not exists worn_size text;

alter table public.creator_items
  add column if not exists default_worn_size text;

-- No backfill needed — both columns nullable, existing rows stay null.
-- No RLS change required — look_items + creator_items already inherit
-- the creator-own policies that gate writes.
