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

**2026-07-10 — Rung 2 (signed device build) SUBMITTED — build 917342c7.**
- Full Apple credential setup completed non-interactively via the ASC API key
  (Key ID NC6S2X9275) — no Apple password prompt. eas.json preview profile now
  carries the production env (gateway URL).
- BOTH targets provisioned under Nicole's team (9JQTW36Y47): the app AND
  ShareExtension — the extension that Vibecode's account-flip kept corrupting.
  This is the structural fix for the July share-extension loop.
- Device 00008150-...401C (Nicole's iPhone) registered + included in the ad-hoc
  profile. Internal distribution → installable via link, no TestFlight needed.
- Toolchain notes for next time: EXPO_APPLE_TEAM_TYPE=COMPANY_OR_ORGANIZATION;
  the ad-hoc device multiselect PRE-SELECTS registered devices — press Enter
  only (a space keystroke DEselects and trips "minimum 1"). Both targets prompt
  for cert-reuse + device-select, so the prompt driver must handle repeats.

**2026-07-10 — ROOT CAUSE of the July share breakage FOUND + FIXED (Apple portal).**
- Build 917342c7 errored: XCODE_BUILD_ERROR — provisioning profile didn't
  support the group.studio.styledinmotion App Group on the main target.
- Diagnosis via Apple Developer portal (Nicole logged in, Claude drove with her
  explicit OK): the MAIN App ID com.vibecode.styled.in.motion-c77kcu had App
  Groups enabled but associated with the WRONG group
  (group.com.vibecode.styled.in.motion-c77kcu) — the app's entitlements declare
  group.studio.styledinmotion ("SiM Share"), which was UNchecked. That mismatch
  is the actual mechanism behind the recurring share-extension failures; Vibecode
  had been masking it with hand-made profiles.
- Fix: checked "SiM Share" (group.studio.styledinmotion) on the main App ID,
  left the existing group in place (extra group in a profile is harmless), Saved
  + confirmed Apple's "profiles will regenerate" warning. The .share extension
  App ID was already correctly associated with both groups — no change.
- No effect on the shipped App Store build (already signed). EAS regenerates the
  ad-hoc profile on the next build.
- ASC API note: the bundleIdCapabilities REST endpoint does NOT report App
  Groups (showed "none" while the portal showed them enabled) — portal is the
  source of truth for App Groups; /v1/appGroups 404s (portal-only).

**2026-07-10 — Rung 2 GREEN. Signed device build 50fc11d0 FINISHED + verified.**
- Downloaded the signed .ipa and inspected codesign entitlements on BOTH targets:
  - main  com.vibecode.styled.in.motion-c77kcu       → application-groups = [group.studio.styledinmotion] ✅
  - .share com.vibecode.styled.in.motion-c77kcu.share → application-groups = [group.studio.styledinmotion] ✅
  Both share the SAME group → the share extension can hand data to the app. The
  July breakage is fixed and PROVEN in the binary (not just the portal).
  Also: main app carries applinks:app.styledinmotion.app (deep links intact).
- Install (internal dist, Nicole's registered iPhone):
  https://expo.dev/accounts/styledinmotion/projects/styledinmotion/builds/50fc11d0-b4a6-4a4b-bed9-80ba5c625b1c
- Backend baked = https://api.styledinmotion.app (verified in rung-1 static scan;
  same eas.json env). Manual on-device tests pending: Safari→SiM share, shop tap,
  Pinterest connect.

**2026-07-10 — ✅ RUNG 2 CONFIRMED ON DEVICE. The migration's founding bug is dead.**
- Nicole installed build 50fc11d0 on her iPhone (Developer Mode enabled once — a
  standard iOS gate for non-App-Store installs, one-time per device).
- Safari → Share → Styled in Motion WORKED and the item landed correctly. This
  is the share-extension flow that had been broken since July; proven fixed on a
  fully Nicole-owned build (her Apple/Expo/GitHub/Supabase, api.styledinmotion.app).
- "Everything else looks good" on device.
- Minor UX papercut (NOT introduced by the migration — we never touched share/
  closet app code): the shared item didn't appear in the closet until she
  navigated out and back in. Pre-existing on-focus refresh gap; flagged as
  optional polish, not a blocker.
- Phase 3 status: the owned build pipeline is fully proven (build → sign → device
  → real backend → share). Remaining Phase 3 = a PRODUCTION (app-store) build →
  TestFlight (Nicole's final check of the exact store binary) → App Store submit
  (Nicole-gated: publishing to real users). Then Phase 4 = adoption gate
  (served_by NULL-rate → 0) → cancel Vibecode → rotate all secrets.

**2026-07-11 — In-sheet share experience (Snapshop-style) BUILT.**
Nicole chose to build the full in-sheet share flow into this release (it's the
feature the migration was for). Reference: ShopMy "Snapshop" — scrape → pick
image → commission → collection → create commissionable link, all in the sheet.
- Backend (deployed v1, verify_jwt=false, tested live on the test creator):
  - share-preview {token,url} → product (name/brand/price + up to 8 images via
    product-info) + commission (real range from affiliate_merchants by domain, or
    null) + creator collections (Looks). Parallel fetch.
  - share-create-link {token,url,choices,collection} → inserts creator_items
    (fetch_status=complete so async re-scrape won't clobber the chosen image),
    attaches to / creates a Look, returns the shop-redirect commissionable link.
  - Verified: Bloomingdale's→2% Rakuten; Free People→not commissionable
    (graceful null); create→item+look+link, link 302s; test rows cleaned.
- Native SwiftUI share extension (plugins/shareExtension/ShareViewController.swift):
  full editor (image gallery picker, note, commission pill "Up to X% commission"
  or "Not commissionable yet", collection Menu incl. New collection, Create Quick
  Link → success card w/ copy). iOS 15.1-safe, typechecks clean. Endpoints
  derived from SIM_SUPABASE_URL (no plugin change). share-add-item kept deployed
  for OLD installs.
- Commission requirement (Nicole): real per-brand number when in-network, calm
  "Not commissionable yet" otherwise — never a fake number. DONE.
- Version 5.6 / build 34. Internal test build 87c5389c building for on-device
  test before the evening App Store push.
