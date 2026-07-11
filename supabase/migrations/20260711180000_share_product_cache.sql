-- "Product memory" — a scrape cache for the share extension. Keyed by the shared
-- product URL; stores ONLY the expensive scraped product blob (name/brand/price/
-- image gallery) so a repeat share of the same product returns instantly instead
-- of re-scraping (which is slow on bot-protected retailers like Aritzia/Revolve).
--
-- Deliberately does NOT cache commission (a fast affiliate_merchants lookup that
-- must stay live) or collections (per-creator, must stay live). Only the
-- creator-agnostic product scrape is cached, so there is no cross-creator leakage.
create table if not exists public.share_product_cache (
  url        text primary key,
  product    jsonb not null,
  cached_at  timestamptz not null default now()
);

-- TTL pruning helper index (share-preview filters on cached_at freshness).
create index if not exists share_product_cache_cached_at_idx
  on public.share_product_cache (cached_at);

-- Service-role only: the edge functions read/write it with the service key
-- (which bypasses RLS). RLS enabled with NO anon/authenticated policies means
-- no client can read or write it directly. (Compliance: RLS-first on every table.)
alter table public.share_product_cache enable row level security;
