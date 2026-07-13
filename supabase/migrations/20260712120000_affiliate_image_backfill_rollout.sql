-- Affiliate image-backfill rollout — paced, polite, server-side drip.
--
-- WHY: Some CJ advertisers (Avidlove ~18k, Especially Yours ~4.3k, Mure and
-- Grand, Mytheresa ~12.2k, ...) arrive from CJ's feed with imageLink=null, so
-- ~34,700 in-stock products have no image and are filtered out of the
-- affiliate_products catalog matview (which requires image + in_stock). The
-- images DO exist on the merchants' own sites; the `affiliate-image-backfill`
-- edge function re-fetches them (Shopify-first .json, general scrape fallback)
-- and writes cj_products.image_urls. It is idempotent + additive, and
-- cj-feeds-sync v5 preserves these on re-sync.
--
-- The merchant sites rate-limit bursts (Avidlove's Cloudflare began blocking
-- after ~200 rapid hits), so this must be a SLOW, POLITE catch-up, not a fast
-- loop. This migration installs one small, well-spaced batch per domain via
-- pg_cron, so the ~34,700 drain over ~1–2 weeks without hammering anyone.
--
-- Surfacing: backfilled products only appear in the catalog after a matview
-- REFRESH. This migration does NOT refresh per-batch (too heavy). It relies on
-- the existing daily refresh; see the REFRESH note at the bottom.
--
-- Batch sizes are tuned to MEASURED per-item latency (2026-07-12 proving run)
-- so a batch finishes well within the edge function's wall-clock limit:
--   avidlove.com        0.40 s/item  (Shopify .json, fast) — 75% yield
--   mureandgrand.com    1.18 s/item  (Shopify .json)       — 60% yield
--   especiallyyours.com 3.35 s/item  (scrape fallback)     — 100% yield  (KEEP BATCHES SMALL)
--   mytheresa.com       scrape/ScrapingBee (slow + credits)              (throttle hardest)
--   oneteaspoon.com     only ~19 image-less left, all unresolvable → NOT scheduled.
--
-- Compliance: new table is RLS-first with no anon/authenticated policies
-- (service/cron only); the SECURITY DEFINER tick function pins search_path and
-- is revoked from anon/authenticated.

-- ---------------------------------------------------------------------------
-- Prereqs (verify at apply time; do NOT assume):
--   1. Extensions pg_cron + pg_net are enabled (the Rakuten/CJ crons use them).
--   2. A Vault secret named 'app_anon_key' holds the project ANON/publishable
--      key used to authorize edge-function calls (the CJ commissions cron uses
--      this same secret). If it is named differently, fix the lookup below.
--   3. Project ref in the URL below is rghlcnrttvlvphzahudf.
-- ---------------------------------------------------------------------------

-- Observability / evidence log (compliance: dated evidence of automated work).
create table if not exists public.affiliate_backfill_log (
  id               bigint generated always as identity primary key,
  ran_at           timestamptz not null default now(),
  domain           text        not null,
  requested_limit  int         not null,
  remaining_before int,                    -- image-less in-stock candidates before this tick
  http_request_id  bigint,                 -- pg_net id; join net._http_response for the result
  note             text
);
create index if not exists affiliate_backfill_log_ran_at_idx
  on public.affiliate_backfill_log (ran_at desc);

-- Service-role / cron only. RLS on, no policies = no anon/authenticated access.
alter table public.affiliate_backfill_log enable row level security;

-- One polite tick for a single domain: count remaining candidates; if any
-- remain, POST one small batch to the edge function; otherwise no-op (zero
-- merchant hits once a domain is drained). Always logs.
create or replace function public.affiliate_backfill_tick(p_domain text, p_limit int default 60)
returns void
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  v_remaining int;
  v_req_id    bigint;
  v_anon      text;
begin
  select count(*) into v_remaining
  from public.cj_products
  where in_stock = true
    and product_url is not null
    and product_url ilike '%' || p_domain || '%'
    and (image_urls is null or image_urls = '{}');

  if coalesce(v_remaining, 0) = 0 then
    insert into public.affiliate_backfill_log(domain, requested_limit, remaining_before, note)
    values (p_domain, p_limit, 0, 'drained: no-op (no merchant hit)');
    return;
  end if;

  -- ANON key just gets us past the edge-function gateway; the function uses its
  -- own SERVICE_ROLE env internally to read/write cj_products.
  select decrypted_secret into v_anon
  from vault.decrypted_secrets
  where name = 'app_anon_key'
  limit 1;

  if v_anon is null then
    insert into public.affiliate_backfill_log(domain, requested_limit, remaining_before, note)
    values (p_domain, p_limit, v_remaining, 'ERROR: vault secret app_anon_key not found');
    return;
  end if;

  select net.http_post(
    url     := 'https://rghlcnrttvlvphzahudf.supabase.co/functions/v1/affiliate-image-backfill',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon,
      'Authorization', 'Bearer ' || v_anon
    ),
    body    := jsonb_build_object('limit', p_limit, 'domain', p_domain),
    timeout_milliseconds := 180000
  ) into v_req_id;

  insert into public.affiliate_backfill_log(domain, requested_limit, remaining_before, http_request_id, note)
  values (p_domain, p_limit, v_remaining, v_req_id, 'posted');
end;
$$;

revoke all on function public.affiliate_backfill_tick(text, int) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schedules — Shopify domains first, staggered across the hour so the pg_net
-- calls don't pile up. Each is a small burst every 30 min; different domains,
-- so this never bursts one merchant. Limits are per measured latency above.
-- (Idempotent: unschedule-if-exists then reschedule.)
-- ---------------------------------------------------------------------------
select cron.unschedule('backfill-avidlove')        where exists (select 1 from cron.job where jobname = 'backfill-avidlove');
select cron.unschedule('backfill-especiallyyours') where exists (select 1 from cron.job where jobname = 'backfill-especiallyyours');
select cron.unschedule('backfill-mureandgrand')    where exists (select 1 from cron.job where jobname = 'backfill-mureandgrand');

-- Avidlove: biggest + fastest. 80/batch every 30 min.
select cron.schedule('backfill-avidlove', '3,33 * * * *',
  $$ select public.affiliate_backfill_tick('avidlove.com', 80) $$);

-- Especially Yours: slow per item (scrape fallback) → keep batches SMALL. 35/batch every 30 min.
select cron.schedule('backfill-especiallyyours', '8,38 * * * *',
  $$ select public.affiliate_backfill_tick('especiallyyours.com', 35) $$);

-- Mure and Grand: small brand. 50/batch every 30 min (drains fast, then no-ops).
select cron.schedule('backfill-mureandgrand', '13,43 * * * *',
  $$ select public.affiliate_backfill_tick('mureandgrand.com', 50) $$);

-- Mytheresa: NOT Shopify — general scrape via ScrapingBee (slow + burns credits).
-- ENABLE ONLY AFTER the Shopify domains drain, and confirm the ScrapingBee
-- credit budget first. Left commented on purpose.
-- select cron.schedule('backfill-mytheresa', '23 * * * *',
--   $$ select public.affiliate_backfill_tick('mytheresa.com', 30) $$);

-- OneTeaspoon: only ~19 image-less products remain and none resolve (0 images
-- from the merchant) → intentionally NOT scheduled.

-- ---------------------------------------------------------------------------
-- SURFACING / REFRESH NOTE:
-- Backfilled products appear in the catalog only after the affiliate_products
-- matview is refreshed. On 2026-07-12 the edge-function refresh path
-- (refresh-affiliate-products) TIMED OUT at its 120s fetch cap on the 640,665-
-- row matview. Confirm the existing daily refresh cron actually completes. If
-- it uses the same 120s edge path, run the refresh INLINE from cron instead
-- (no 120s cap; CONCURRENTLY takes no read lock, so the catalog stays live):
--
--   select cron.schedule('affiliate-products-refresh', '15 2,14 * * *', $$
--     set local statement_timeout = '20min';
--     refresh materialized view concurrently public.affiliate_products;
--   $$);
--
-- Reconcile with any existing 'affiliate-products-refresh-daily' job before
-- adding this (don't double-schedule).
-- ---------------------------------------------------------------------------

-- Verify after apply:
--   select jobname, schedule, active from cron.job where jobname like 'backfill-%';
--   select domain, note, remaining_before, ran_at from public.affiliate_backfill_log order by ran_at desc limit 20;
--   -- product_count should climb from 0 for Avidlove / Especially Yours / Mure and Grand after a refresh:
--   select merchant_name, product_count from public.affiliate_merchants
--     where merchant_name in ('Avidlove','Especially Yours','Mure and Grand');
