-- Cache of resolved Amazon ASIN product info (name/image/price) used by the
-- batch product-info resolver. The table already exists in prod and is fully
-- pre-populated; this migration is an idempotent no-op there, present only for
-- VCS / schema-discipline parity. Backend reads/writes it via the service-role
-- client, so RLS is enabled with no anon policy.

create table if not exists public.product_info_cache (
  asin          text primary key,
  product_name  text,
  image_url     text,
  product_url   text,
  price         numeric,
  currency      text,
  brand_name    text,
  source        text,
  fetched_at    timestamptz default now()
);

alter table public.product_info_cache enable row level security;
