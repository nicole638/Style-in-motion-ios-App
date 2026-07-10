# Styled in Motion — Migration off Vibecode (reviewed plan)
Date: 2026-07-09 · Full workspace export: this folder (`workspace/`, includes git history)

## Review findings (what changes the original plan)

1. **Phase 2 ("get the iOS source out") is effectively DONE.** Claude has SSH access and
   exported the entire workspace today — mobile app, backend, supabase dir, docs, git
   history — to `~/styled-in-motion-edits/2026-07-09-vibecode-full-export/workspace/`.
   The only remaining step is pushing it to a GitHub repo Nicole owns. No Vibecode
   cooperation needed. ⚠️ Until that push happens, this folder is the ONLY copy outside
   Vibecode — the GitHub push is therefore step 1, not step 2.

2. **The real production risk the plan missed: the App Store binary hard-codes
   `https://meadow-grindstone.vibecode.run`** (in `mobile/eas.json` production env →
   `EXPO_PUBLIC_BACKEND_URL`). Shipped binaries can never be repointed. The moment
   Vibecode is cancelled, that domain dies and **shopping links break inside every
   already-installed copy of the app**. So "turn off Vibecode" must be gated on:
   new build (pointing at Nicole-owned URLs) live in the App Store **+** an adoption
   window. Everything else can move fast; this gate is the schedule.

3. **Good news the plan under-sold:** `app.styledinmotion.app` (deep links / share links /
   universal links, and the app's `associatedDomains`) points at **Vercel — Nicole's**,
   not Vibecode. Deep links survive the migration untouched.

4. **The backend surface to port is small.** Routes the iOS app actually calls:
   `/api/shop` (28 call sites — revenue), `/api/product-info` (4), `/api/social-followers`
   (3), `/api/remove-background` (1), `/api/campaigns` (1). `share-beacon`/`sample`/
   `accounts` have no app callers (diagnostics/dead — verify `accounts` isn't used by
   creators-web, then drop). `awin-sync` = cron. Also: `affiliate-wrap-url` and
   `share-add-item` edge functions ALREADY exist on Supabase — parts of this work are done.

5. **Architecture rule so this never recurs:** the app may only ever bake **domains
   Nicole owns**. New backend base URL = `api.styledinmotion.app` (her DNS), routed to
   Supabase edge functions. If a host ever needs to change again, it's a DNS edit — not
   an App Store release.

6. **Secrets are committed to git** (`backend/.env` incl. `SUPABASE_SERVICE_ROLE_KEY`,
   OpenAI, Photoroom, ScrapingBee, AWIN; `eas.json` holds keys too) and that history
   lives on Vibecode's git server. → New GitHub repo starts with a **clean history**
   (full-history tarball stays archived here), proper `.gitignore`, secrets moved to
   EAS secrets / Supabase function secrets, and **all keys rotated** at cutover.

7. **Identity facts to preserve:** bundle id `com.vibecode.styled.in.motion-c77kcu`
   (cosmetic "vibecode" — KEEP IT; changing it = a brand-new App Store app),
   ASC app id `6761640911`, Expo owner `styledinmotion`, EAS projectId
   `88f99d01-2dba-4ece-8fa4-0a998b84c86b`, share-ext bundle `…-c77kcu.share`,
   app group `group.studio.styledinmotion`.

8. **Repo gap:** 78 edge functions are deployed on Supabase; only 4 exist in the repo.
   Pull every deployed function's source into the new repo (scripted via Supabase API).

9. **Dev workflow replacement** (what Vibecode actually provided day-to-day): instant
   JS updates to Nicole's phone. Replacement = **EAS Update (OTA)** under her Expo
   account + TestFlight for native builds. Same-day fixes continue, minus Vibecode.

## The plan (risk-ordered)

### Phase 0 — Secure the code (DONE today)
Full export incl. git history → this folder. Pinterest login fix deployed + included.

### Phase 1 — Own the source (zero production risk, ~1 day)
- Nicole creates private GitHub repo `styled-in-motion-app` (or grants a short-lived PAT).
- Push the exported tree as a clean initial commit (fixed `.gitignore`, no `.env`).
- Script-pull all 78 deployed edge-function sources into `supabase/functions/`.
- Result: Vibecode no longer holds anything unique.

### Phase 2 — Backend off Vibecode (no app release needed, ~2–4 days)
- Stand up `api.styledinmotion.app` (Nicole's DNS → Supabase edge functions).
- Port, in order: `shop-redirect` (with the CJ/Rakuten/AWIN wrap + click_events logging,
  already-diagnosed logic), `product-info` (merge with existing `scrape-product`),
  `social-followers`, `remove-background` (swap caller to existing `photoroom-edit`),
  `campaigns`, `awin-sync` (as cron like the rakuten/cj syncs).
- New functions tag their click_events rows (api_origin marker) → gives a live adoption
  metric for the Phase 4 gate.
- Repoint web + creators-web (Vercel env vars — instant, reversible) to the new URLs.
- Parity-test against the old backend before anything else depends on it.

### Phase 3 — Builds under Nicole's control (the share-extension fix, done right)
- Verify: App Store Connect — app 6761640911 is under **Nicole's Apple team** (expected;
  if it were ever Vibecode's, Apple's App Transfer flow exists — check first, assume nothing).
- Consolidate to ONE Expo account (`styledinmotion`): confirm/move the EAS project,
  set credentials once (distribution cert, push key, share-ext profile with the app
  group on the right App ID — the exact thing the two-account flip kept breaking).
- Update `eas.json`: `EXPO_PUBLIC_BACKEND_URL=https://api.styledinmotion.app`; move
  secrets out of the file into EAS secrets.
- Build → TestFlight → full regression of core flows (shop redirect + click logging,
  product add, share extension, Pinterest connect, follows/saves) → submit to App Store.

### Phase 4 — Adoption gate → decommission (the only waiting period)
- Gate: new version live + old-build traffic ≈ 0 (watch untagged vs tagged click_events),
  or a fixed 2–4 week window given current install base.
- Then: cancel Vibecode. Rotate ALL secrets (service-role key, OpenAI, Photoroom,
  ScrapingBee, AWIN, and any GitHub PAT used). Keep this export folder as the archive.

## What only Nicole does
1. Create the private GitHub repo (+ PAT for the push; revoke after).
2. Confirm the Apple Developer team on App Store Connect shows the app.
3. Confirm/provide access to the `styledinmotion` Expo account (and note what
   `flyoverapp` still owns, if anything).
4. Keep Vibecode paid ONLY until the Phase 4 gate clears — that's the cost end-date.

## Do-not-touch list
- Supabase project `rghlcnrttvlvphzahudf` (already Nicole's; it is the production data plane).
- `app.styledinmotion.app` DNS (universal links for the SHIPPED app).
- Bundle id + app group + ascAppId (the app's permanent identity).

---
## Progress log

**2026-07-09 — Phase 2 started. `/api/shop` (the revenue path) is ported and verified.**
- New edge function `shop-redirect` (v2, ACTIVE, public) on Supabase — logic verbatim
  from the Hono route; source committed to `workspace/supabase/functions/shop-redirect/`.
- Migration `20260709210000_click_events_served_by.sql` applied + mirrored: new rows
  from the edge function carry `served_by='edge'`; legacy Hono rows stay NULL — this is
  the live adoption metric for the Phase 4 decommission gate.
- Parity verified against the LIVE legacy backend, same fixtures, side by side:
  Amazon (302 + tier-2 creator subtag + ascsubtag), CJ (302 DLG + iOS PID + sid),
  raw fallback (302 raw via affiliate-wrap-url), HEAD handling, 404 + validation
  envelopes byte-identical, and the logged click_events rows match on every
  attribution field. All 10 test rows deleted after comparison.
- One intentional behavior note: port accepts GET+HEAD (Hono auto-served HEAD).
- Remaining Phase 2: product-info, social-followers, remove-background, campaigns,
  awin-sync(cron); then the api.styledinmotion.app front door + web/creators-web repoint.

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

**2026-07-10 — API front door LIVE (gateway verified end-to-end).**
- Vercel project `style-in-motion-ios-app` imported from the GitHub repo
  (rootDirectory=api-gateway) — auto-deploys on every push, like the sites.
- Full suite passed via the gateway: /api/shop 302 pass-through with wrapped
  affiliate URL + served_by='edge' click row (verified then deleted);
  product-info batch; social-followers validation; remove-background cache
  hit (same file); dead legacy routes (sample/accounts/share-beacon/awin-sync)
  correctly 404 (allowlist).
- DNS: api.styledinmotion.app CNAME → Vercel (Squarespace). Remaining half-step:
  add the domain in the Vercel project (Settings → Domains) so Vercel claims
  the hostname + provisions the cert. Then Phase 3 bakes
  EXPO_PUBLIC_BACKEND_URL=https://api.styledinmotion.app into the new build.
- Registrar 2FA enabled by Nicole (also logged in compliance evidence).

**2026-07-10 — api.styledinmotion.app VERIFIED LIVE. Phase 2 gateway complete.**
- Domain attached to the Vercel project, TLS cert issued (CN=api.styledinmotion.app).
- Verified on the real domain: /api/shop 302 with wrapped affiliate URL +
  creator subtag (test row confirmed served_by='edge', then deleted);
  campaigns/product-info 200; validation 400; dead routes 404.
- The app's future backend URL is now permanently Nicole-owned:
  Phase 3 bakes EXPO_PUBLIC_BACKEND_URL=https://api.styledinmotion.app.
- Optional (Vercel's suggestion, not required): update the Squarespace CNAME
  value for `api` to `9d93cf4830e00731.vercel-dns-017.com.` — the current
  record works; Vercel just prefers their newer format.
- Still open in Phase 2: repoint the two websites' backend URL env vars to
  the new domain (Nicole dashboard task, non-urgent — they can follow any
  time before decommission; check whether the shopper site references
  meadow-grindstone at all while doing it).

**2026-07-10 — Rung 1 passed: first fully-owned build verified.**
- EAS build 39e05f7a (simulator profile) under the styledinmotion account.
- Static inspection of the artifact: api.styledinmotion.app baked in (1 ref),
  meadow-grindstone ZERO refs, correct bundle id, ShareExtension.appex
  embedded.
- Dynamic: installed + launched on the iPhone 17 Pro simulator — welcome
  screen renders cleanly (screenshot verified).
- Apple ASC API key received (Key ID NC6S2X9275), stored at
  Documents/Styled-in-Motion/credentials/ (outside git; *.p8 gitignored).
- Rung 2 (device build w/ real signing + share-extension provisioning) blocked
  only on the ASC Issuer ID.
