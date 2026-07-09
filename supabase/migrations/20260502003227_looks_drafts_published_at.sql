-- Drafts feature for creators: nullable published_at column on looks.
-- published_at IS NULL  → draft (creator-only)
-- published_at IS NOT NULL  → publicly viewable (subject to archived = false)
--
-- Migration order matters: add column without default first, backfill
-- existing rows from created_at (so already-public looks stay public),
-- then add the now() default so future INSERTs that don't specify
-- published_at are still published (preserves current mobile behavior
-- until the create flow ships the explicit Save Draft path).

alter table public.looks
  add column if not exists published_at timestamptz;

-- Backfill: every non-archived row was already public, so mark it
-- published with its original create timestamp.
update public.looks
   set published_at = created_at
 where published_at is null
   and archived = false;

-- Default for new rows = now(). Mobile passes null explicitly to mark
-- a draft.
alter table public.looks
  alter column published_at set default now();

-- Index for the public-feed filter; the existing creator_id index keeps
-- per-creator drafts cheap.
create index if not exists looks_public_feed_idx
  on public.looks (published_at desc)
  where archived = false and published_at is not null;

-- Update the public-read RLS policy to also gate on published_at.
-- Drop + recreate is the cleanest way to change a USING clause.
drop policy if exists "Public can view non-archived looks" on public.looks;

create policy "Public can view published looks"
  on public.looks for select
  to public
  using (archived = false and published_at is not null);
-- The other 4 policies (creator own select/insert/update/delete) are
-- unchanged and continue to let creators manage their own drafts.
