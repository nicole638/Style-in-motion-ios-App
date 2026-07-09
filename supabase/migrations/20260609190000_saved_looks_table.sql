-- Saved looks — shoppers bookmark a whole look from the "Shop This Look"
-- sheet. DB-backed (mirrors saved_items / likes / follows) so saves persist
-- cross-device and survive reinstall. This is distinct from a "like" (the
-- heart, a public count): a save is a private collection entry.
--
-- Dedupe key is look_id. A denormalized byline + cover snapshot lets the
-- Saved tab render the card without depending on lookStore.looks (which only
-- holds the signed-in creator's OWN looks — the reason shopper-saved looks
-- used to vanish from Saved). Opening a saved look re-fetches its items via
-- fetchLookById.

create table if not exists public.saved_looks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  look_id uuid not null,            -- the saved look (dedupe key)
  creator_id uuid,                  -- look.creator_id (byline routing)
  -- denormalized display snapshot
  title text,
  cover_photo_url text,
  item_count int,
  creator_name text,
  creator_photo_url text,
  is_brand boolean default false,
  brand_name text,
  brand_slug text,
  brand_logo_url text,
  created_at timestamptz default now(),
  unique (user_id, look_id)
);

alter table public.saved_looks enable row level security;

create policy "Users can view their own saved looks"
  on public.saved_looks for select
  using (auth.uid() = user_id);

create policy "Users can insert their own saved looks"
  on public.saved_looks for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own saved looks"
  on public.saved_looks for delete
  using (auth.uid() = user_id);

create index if not exists saved_looks_user_id_idx on public.saved_looks (user_id);
create index if not exists saved_looks_look_id_idx on public.saved_looks (look_id);
