# api-gateway — api.styledinmotion.app

The app's permanent API front door (Vibecode migration, Phase 2). A pure
routing layer on Vercel: it proxies the legacy backend's exact `/api/*` paths
to the Supabase edge functions, so clients only ever bake a domain Nicole
owns. If the backing host ever changes again, this file changes — not the
App Store binary.

| Public path                 | Backing Supabase function |
|-----------------------------|---------------------------|
| /api/shop                   | shop-redirect             |
| /api/product-info           | product-info              |
| /api/social-followers       | social-followers          |
| /api/remove-background      | remove-background         |
| /api/campaigns/*            | campaigns                 |

Deliberately allowlist-only: legacy routes with no callers (sample, accounts,
share-beacon, awin-sync) are not exposed. Query strings, request bodies,
response status codes (incl. the shop 302) pass through unchanged.

Deployed as the Vercel project `styledinmotion-api` (team styledinmotion),
domain `api.styledinmotion.app`.
