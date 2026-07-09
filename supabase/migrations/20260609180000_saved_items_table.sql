-- Saved items — shoppers bookmark individual shoppable pieces from the
-- "Shop This Look" sheet. DB-backed (mirrors likes/follows) so saves persist
-- cross-device and survive reinstall, the way purchase intent should.
--
-- Dedupe key is creator_items.id (the canonical item). We also store the
-- look context (look_id, look_item_id, creator_id) for click attribution and
-- a denormalized snapshot (name/brand/price/photo/link/affiliate) so the
-- Saved tab can render + shop without joining back to live tables.

create table if not exists public.saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null,            -- creator_items.id (canonical dedupe key)
  look_id uuid,                     -- look the item was saved from
  look_item_id uuid,                -- look_items.id (for /api/shop attribution)
  creator_id uuid,                  -- look.creator_id (bypass-path attribution)
  -- denormalized display/shop snapshot
  name text,
  brand text,
  price text,
  photo_url text,
  emoji text,
  link text,
  affiliate_url text,
  look_photo_url text,
  created_at timestamptz default now(),
  unique (user_id, item_id)
);

alter table public.saved_items enable row level security;

create policy "Users can view their own saved items"
  on public.saved_items for select
  using (auth.uid() = user_id);

create policy "Users can insert their own saved items"
  on public.saved_items for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own saved items"
  on public.saved_items for delete
  using (auth.uid() = user_id);

create index if not exists saved_items_user_id_idx on public.saved_items (user_id);
create index if not exists saved_items_item_id_idx on public.saved_items (item_id);
