
**2026-07-09 (later) — Phase 2 backend ports COMPLETE. Every live legacy route
now has a verified Supabase twin.**
- `social-followers` (v1): identical counts vs legacy (@zara → 62,000,000 both
  sides — also proves SCRAPINGBEE_API_KEY exists in the functions runtime).
- `remove-background` (v1): cache interop proven — legacy created a cutout via
  Photoroom, the edge function returned the SAME file from cache (hash-exact).
- `campaigns` (v1): byte-identical JSON (58 active campaigns).
- `product-info` (v1, 8-file bundle): batch-ASIN branch byte-identical;
  single-URL branch identical on name/brand/imageUrl (same shared image cache
  file!)/canonicalUrl/ASIN. Known behavior note: Amazon bot-blocks the edge
  runtime's direct fetch more often than the legacy host, so Amazon lookups
  fall to the ScrapingBee tier more (slightly higher scraper usage; also means
  the displayed price can reflect a different Amazon offer — price is a
  creator-editable prefill). Port change log: no subprocesses in the edge
  runtime, so cacheMerchantImage's curl/HTTP-1.1 fallback became a
  fingerprinted fetch retry (fail-soft pass-through unchanged).
- `awin-sync` NOT ported — confirmed dead: no cron targets it and its
  `hono_full_ingest` flag column no longer exists; the awin-*-sync edge
  functions (jobs 2–5 in pg_cron) are the live pipeline.
- Legacy Hono routes with no callers (sample, accounts, share-beacon):
  retired with the backend at decommission; creators-web check for `accounts`
  still pending before final shutoff.
- Remaining Phase 2: api.styledinmotion.app front door + repoint web/creators-web.
