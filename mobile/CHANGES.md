# Styled in Motion — Change Log / Handoff

Running log of cross-cutting changes so multiple sessions stay in sync.
Last updated: 2026-07-21 (linkless-shop fix + not-shoppable preview + TikTok share fix). Scope: the **mobile** app.

## 2026-07-21 — Shop dead-tap fix, Not-shoppable preview, TikTok share fix (commits 5d66141, 0eaa496, 9bc36de)

- `src/lib/shoppable.ts` (NEW) — single source of truth `isShoppable()` (affiliate_url OR url; null/''/whitespace/'#' = no link) + `NOT_SHOPPABLE_LABEL`. Mirrors web `resolveOutboundUrl()`.
- `src/components/ItemListSheet.tsx` — linkless rows: dimmed (0.7), "Not shoppable" label (was "Soon"), tappable → NEW in-modal read-only preview card (large photo, name, brand, price, worn size, note, pill, Close). Never calls /api/shop for linkless items.
- `src/components/ItemDetailSheet.tsx` — creator's linkless items show "Add a link" (routes to item editor, never collage builder) instead of a dead "No link yet" Shop row; bypass URL prefers affiliate_url.
- `src/app/(public-tabs)/saved.tsx` — linkless saved cards: not pressable, dimmed, "Not shoppable" replaces price; bookmark still works.
- `src/app/(tabs)/shop.tsx` + `src/app/(tabs)/index.tsx` — hasLink → isShoppable(); "Soon" → "Not shoppable"; trim/'#' guard on shop handler.
- `src/lib/utils/downloadToCache.ts` (NEW) — resolve any image URI to a local file:// in cacheDirectory (no photo-library side effects; caller owns cleanup).
- `src/lib/utils/shareToTikTok.ts` — SDK now receives a LOCAL file (wrapper saves to Photos itself; remote https → "Failed to save media"). Dropped redundant app-side savePhotoToLibrary (single Photos save), permission denial → 'permission-denied' outcome, errorCode/subErrorCode appended to failure alerts, temp cleaned in finally. savePhotoToLibrary untouched (IG flow).
- `app.json` — version 5.9 (Apple closes an approved train — bump marketing version EVERY TestFlight push); iOS buildNumber 39; Android blockedPermissions += FOREGROUND_SERVICE, FOREGROUND_SERVICE_LOCATION, FOREGROUND_SERVICE_MEDIA_PLAYBACK, ACCESS_*_LOCATION (Play rejection fix); android versionCode 39.
- SHIP STATE: 5.9 (38) on TestFlight (linkless fix only). 5.9 (39) built+parked on EAS (adds preview). TikTok fix is committed, NOT yet built. **Do not auto-submit — Nicole batches fixes and gates every ship.**
Stack: Expo 54 / RN 0.81.5 / NativeWind 4.2.1 / Tailwind 3.4.18.

> MAINTENANCE: Keep this file current. Any session that changes code here must append an
> entry (file(s) touched + what/why) and bump "Last updated". This is the sync point between
> chats — update it before you finish, and the user persists it via Save in the Vibecode app.

## Files changed (14 — 2 new)

New:
- `src/constants/theme.ts` — design tokens, single source of truth: `COLORS` (17 tokens), `FONTS` (Cormorant serif + DM Sans weights), `RADIUS`.
- `src/components/PillButton.tsx` — shared button component.

Modified:
- `tailwind.config.js` — filled the previously-commented `colors` block with the 17 tokens; added `serif`/`sans` fontFamily ONLY (do not add `medium`/`semibold`/`bold` — they collide with Tailwind font-weight utilities used ~62x).
- `src/app/payments-payouts.tsx` — local `COLORS` now sourced from `theme.ts` (worked example).
- `src/app/(tabs)/create.tsx` — new `StepChooseFlow` decision screen + wizard CTA migration.
- `src/app/(tabs)/shop.tsx`, `src/app/(tabs)/brands.tsx`, `src/app/(tabs)/index.tsx`,
  `src/app/add-closet-item.tsx`, `src/app/creator-account.tsx`, `src/app/look/[id].tsx`,
  `src/app/amazon-campaigns.tsx`, `src/components/HashtagEditor.tsx`, `src/components/BrandSelector.tsx`
  — button migrations to `PillButton`.
- `src/lib/state/lookStore.ts` — typed DB row mappers, `deleteLook` revert-on-failure, removed prod
  debug logs (lookStore cleanup, batch 1).

## What changed, by feature

### 1. Design system
Extracted the real palette into `theme.ts` + Tailwind. Actual hexes (cream `#F7F4F0`, ink
`#1A1210`, coral `#B87063`, etc.) differ from the README's stated `#FAF8F5` / `#1A1A1A`.
~72 files still hardcode hexes; migration is incremental — only `payments-payouts.tsx`
migrated so far, as the pattern example.

### 2. Create landing redesign
`create.tsx` step 0 is now a `StepChooseFlow` decision screen with two cards:
- Build a Collage -> `router.push('/collage-builder')`
- Style a Look -> existing photo-upload flow

Gated by `FEATURE_COLLAGE && !isEditMode && !photoUri && !lookFlowChosen`. New `lookFlowChosen`
state; step-0 back returns to the chooser; removed the old inline `+ New Collage` button.

### 3. PillButton + full button sweep
All interactive buttons now route through `PillButton`.
- Variants: `primary` (coral) | `dark` (ink) | `outline` (white/coral border) | `secondary`
  (white/ink border) | `tertiary` (text).
- Props: `size` (md/sm), `icon`, `loading`, `disabled`, `fullWidth`, `haptic`, `testID`.
- Migrated: the +Add family, all Create wizard CTAs (were off-brand gray `#DCDCDC`), inline Add
  pills, both FABs (Home FAB kept circular via className; Shop FAB -> ink pill), Browse Looks,
  Paste / Re-fetch. Orphaned StyleSheet entries were left behind (harmless).

Color language now in use:
- coral = add / move forward
- ink = save / commit
- white outline = secondary / cancel
- text = low-emphasis

### 4. lookStore cleanup (sequenced; god-object, ~1600 lines)
Batch 1 (DONE): typed DB row interfaces (`CreatorItemRow` / `LookItemJoinRow` / `LooksRow`) replace
`any` in the row mappers; `deleteLook` reverts its optimistic removal if the DB delete fails (was a
silent ghost-delete); removed production `console.log` payload dumps in addLook/updateLook.
Batch 2a (DONE): renamed the unused `deleteItemFromCloset` -> `getClosetItemUsage` (returns a usage
count, deletes nothing; zero callers); finished typing the remaining row `any`s (findByUrl, the
updateLook join-diff via `ExistingLookItemJoin`, the addItemToLook seed-size read).
Batch 2b (DONE): (1) atomic click increments — added Postgres RPC `increment_look_clicks(p_look_id uuid)`
(SECURITY DEFINER, EXECUTE granted to anon+authenticated). Migration file
`supabase/migrations/20260524210000_increment_look_clicks_rpc.sql`; **applied to prod DB** via Supabase
MCP (project `rghlcnrttvlvphzahudf`). `incrementClicks` now calls the RPC instead of a client
read-modify-write, so concurrent clicks no longer lose increments (and anon viewers can increment).
(2) extracted the duplicated addLook/updateLook item-resolution + dedupe into a shared
`resolveLookItemJoins(creatorId, lookId, items)` helper.
Remaining (NOT started): adopt React Query for reads/mutations + `fetchLooks` pagination; then split
the `looks` slice (public feed vs creator-own — LATENT, not active) and decompose into look / draft /
closet stores. (Slice split folded into the React Query migration, not a risky standalone refactor.)

### 5. Look-card metadata badges (evidence-of-use, started)
Cards across the app should consistently surface usage signals (clicks, hearts, items) — the
pattern that makes refs like The Edit / Nove feel "finished." Foundation already exists on the
creator Home grid (`(tabs)/index.tsx`'s LookCard shows `N items` + `N clicks · ❤ N`).
- `(public-tabs)/feed.tsx` — added a top-right `❤ {look.likes_count}` pill on every discover-feed
  card (was bare: only photo + handle, no social proof). Gated on `likes_count > 0`.
- `(tabs)/shop.tsx` — added `♥ {look.likesCount}` next to `{look.clicks} taps` in the Looks-grid
  metadata row, bringing it to parity with Home.
- `(tabs)/shop.tsx` — closet item tiles now show `In N look(s)` under the price when the item is
  referenced by ≥1 of the creator's published looks. Count derived from in-memory `allLooks`
  via a memoized `itemUsageMap`; no extra DB round-trip. Style: 11px DM Sans Regular muted
  (`#8C8580`) so it reads as a quiet evidence-of-use line.

### 5b. Re-wired the dropped shopper like interaction (DONE)
The like infrastructure (`likeStore.toggleLike` + optimistic+revert + 23505 race handling) was
fully intact, but UI callers had been stripped everywhere except `saved.tsx` (un-save only).
Shoppers could see hearts on cards but couldn't contribute to them — backwards UX. Re-wired:
- `look/[id].tsx` — added `Heart` import + `useLikeStore` subscriptions; replaced the inert
  `headerSpacer` on the right side of the header with a tappable heart button (40×40, hitSlop 12,
  `testID="look-detail-like-button"`). Fills coral (`#B87063`) when liked. Seeds the store count
  from `look.likesCount` on load via `initCounts`.
- `(public-tabs)/feed.tsx` — converted the display-only likes pill (just added in 5) into a
  `<Pressable>` calling `toggleLike(look.look_id)`. Heart fills coral when liked. Pill renders
  on every card (heart-only when count is 0, heart + count when ≥1). Per-card `useEffect` seeds
  `initCounts` from `look.likes_count`.
- `creator-profile.tsx` — same pattern on the grid tile overlay. Also fixed a pre-existing
  reactivity bug: `const getLikeCount = useLikeStore((s) => s.getLikeCount)` subscribed to a
  function reference and never triggered re-render on count change; rewrote as a `useCallback`
  wrapper over a `likeCounts` subscription so the displayed number actually updates on toggle.
- Also added **tap count** next to the heart on the creator-profile tile overlay
  (`❤ N · {clicks}`) — was the second-half of the badge sweep.

### 5c. Per-look earnings ("$X earned") on creator tiles (DONE)
- **New file** `src/lib/queries/creatorEarnings.ts` — `useCreatorEarnings(creatorId)` React Query
  hook returning `Record<lookId, number>`. Queries `commissions` with `click_events!inner(look_id)`
  embed, filters status to `pending | confirmed | paid` (matches `payments-payouts.tsx`'s
  convention), sums `creator_share` client-side. 5 min `staleTime`. Also exports `formatEarnings`
  (`$X.XX`; empty string for ≤0 so callers can render null).
  - Read directly from the client — `commissions` RLS ("creators read own") and `click_events`
    RLS ("Creators can view clicks on their looks") both allow it; no SECURITY DEFINER needed.
  - Volume context: 0 commissions live currently. If a creator accumulates thousands of rows,
    swap for an `creator_look_earnings(creator_id)` Postgres RPC; the hook return shape stays the
    same so tile consumers don't need to change.
- **`(tabs)/index.tsx`** — Home grid `LookCard` gets an `earned: number` prop. Existing meta line
  appends ` · $X.XX` when earned > 0. Result: `12 clicks · ❤️ 47 · $8.40`.
- **`(tabs)/shop.tsx`** — Shop Looks grid adds a 4th meta entry (`gridCardEarned` style — coral
  + DMSans_500Medium for slight emphasis on money). Result: `[3 items] · 12 taps · ♥ 47 · $8.40`.

Public surfaces (creator-profile, feed) intentionally **do not** show earnings.

### 6. Click-event writer surgery — dedupe + source='ios' (DONE)
Investigating an Amazon attribution complaint revealed two independent issues:
- The mobile `logClickEvent()` and the backend `/api/shop` handler were BOTH inserting into
  `click_events` for the same shopper tap (different rows, slightly different shapes — backend
  has the resolved 3-tier Amazon tag, mobile does not). In practice only the backend row was
  landing because of RLS (the mobile insert was silently failing — see below), but the
  architecture was fragile.
- Every row in `click_events` had `source: null` despite a recent commit claiming to wire
  `source: 'ios'`. The mobile `logClickEvent()` sets it but those inserts are silently failing;
  the backend insert was never setting `source` at all.

Fix:
- **`backend/src/routes/shop-redirect.ts`** — reads `?src=` query param (allow-list `ios|web|android`),
  writes to the `source` column on the click_events insert.
- **`mobile/src/app/(public-tabs)/saved.tsx`**, **`mobile/src/components/ItemDetailSheet.tsx`**,
  **`mobile/src/components/ItemListSheet.tsx`** — the 3 sites that conditionally route through
  `/api/shop`. Each now (a) appends `&src=ios` to the `/api/shop` URL, and (b) only calls
  `logClickEvent` on the BYPASS path (when `!useEf`) so we don't double-write.
- **NOT touched** — the 8 other `logClickEvent` call sites bypass `/api/shop` entirely (they use
  `Linking.openURL` to a raw item URL). Those remain the only writer for their flow.

### 6b. Brand-catalog click loss — RLS null-look_id fix (DONE)
The `click_events` INSERT policy had `WITH CHECK (EXISTS … FROM looks WHERE id = look_id …)`.
That clause is FALSE when `look_id IS NULL`, so every `logClickEvent` with a null `lookId`
(the 3 brand-catalog callers in `app/brand/[id].tsx`) silently failed RLS. The mobile function
swallows the error in try/catch and just `console.warn`s, so the failure was invisible —
brand-catalog tap counts were not being recorded at all.

Fix: migration `supabase/migrations/20260605180000_loosen_click_events_insert_allow_null_look_id.sql`,
**applied to prod DB** via Supabase MCP. The policy is now
`WITH CHECK (look_id IS NULL OR EXISTS (...))`; look-bound rows still validate the FK to a
non-archived look.

### 6c. Test-burst forensics + `is_test_burst` filter column (DONE)
While reconciling our DB click counts against Amazon Associates Central we found a sustained
discrepancy. After excluding the two test creators (Jade Kim, Mia Santos) and Reilly (Tier-1
own-account, doesn't appear in the master report), we narrowed it to 172 (our DB) vs 116
(Amazon) over a 4-week window — but three sub-minute "bursts" still inflated our side:
- 2026-05-18 00:36–00:39 UTC: 71 clicks across 9 creators (incl. all test accounts)
- 2026-05-26 09:47 UTC: 73 clicks in a single minute across 3 real creators
- 2026-06-03 21:39–21:41 UTC: 44 clicks across 3 real creators in 30 seconds

All burst rows share the same signature: `user_id IS NULL` + `source IS NULL` + sub-second
walks through creators sequentially. No code-level source — searched `backend/`, `supabase/`,
`scripts/`, all edge functions, tests, and cron configs; nothing in the repo writes
`click_events` except the legit `/api/shop` handler. The bursts are external HTTP traffic to
that endpoint — almost certainly a Vibecode prompt or manual QA pass that walked every
(creator, look, item) tuple.

Fix:
- **Migration** `supabase/migrations/20260605190000_click_events_is_test_burst.sql` (applied
  via Supabase MCP) adds `is_test_burst boolean NOT NULL DEFAULT false` + a partial index on
  `clicked_at WHERE is_test_burst = true`, then backfills the three burst windows guarded by
  `user_id IS NULL AND source IS NULL` so no real signed-in shopper ever gets flagged.
  Result: 188 rows marked (29% of 645 total), 457 marked real.
- **`mobile/src/lib/queries/creatorStats.ts`** — `clickCount` query now adds
  `.eq('is_test_burst', false)`. The "Your performance" hero card stops over-counting.
- **`mobile/src/lib/queries/creatorEarnings.ts`** — per-look earnings query embeds
  `is_test_burst` and skips matching rows client-side. Defensive only (real commissions never
  flow from test traffic) but keeps the data model consistent.
- Going forward: every real iOS shopper tap carries `source='ios'` (from §6 above) and starts
  at `is_test_burst=false`. The column will only contain the historical backfill.

### Duplicate creator cleanup
Deleted a dormant duplicate Kerri row (`6b67687c-…`, `kerri.styledinmotion@gmail.com`,
zero refs across looks/items/clicks/commissions, empty profile cascade). Only Kerri remains:
`8390038f-…` (`kerri@styledinmotion.app`, `styledinmotio-kerri-20`, 30 looks, 183 clicks).
Audited all other creators by name (case-insensitive), email (case-insensitive AND
gmail-dot-normalized), and `creator_profiles.username` — **no other duplicates** anywhere.

### 6d. Full traffic-channel attribution — Referer + User-Agent + web inference (DONE)
Pre-launch cleanup so we never have to revisit who-clicked-from-where. Two columns added to
`click_events`, captured on every `/api/shop` hit, plus a server-side fallback that infers
`source='web'` when no explicit `?src=` is passed but a Referer header is present (so the
external `shop.styledinmotion.studio` frontend works without needing its own deploy).
- **Migration** `supabase/migrations/20260605200000_click_events_referer_user_agent.sql`
  (applied to prod via Supabase MCP): adds `referer text` + `user_agent text` columns, plus a
  partial index on `referer` for cheap GROUP-BY-host analytics.
- **`backend/src/routes/shop-redirect.ts`** — reads `referer` + `user-agent` request headers,
  writes them on the click_events insert, and falls through to `source='web'` when no
  explicit query-param `src` is provided AND a Referer is present. The `?src=` allow-list is
  still honored (mobile sends `ios`; a future web deploy can send `web` if desired).
- **Privacy note documented in the migration:** IPs are deliberately NOT captured. Referer
  and User-Agent are standard request metadata used for affiliate attribution.

Result: launching with full Instagram-vs-Pinterest-vs-direct-vs-web attribution in place. Sample
analytics query:
```sql
select coalesce(source,'<null>') as src,
       substring(referer from 'https?://([^/]+)') as ref_host,
       count(*)
  from click_events
 where clicked_at > now() - interval '7 days' and is_test_burst = false
 group by 1, 2 order by 3 desc;
```

### 6f. Storefront context switcher + iOS plumb + brand-aware byline (DONE)
Foundational iOS surface for the Golden Bear Garage launch — the schema/seed
from §6e is now connected to the app. Kerri can sign in as herself, switch
into the "Golden Bear Garage" context, and every look or item she publishes
saves under the brand storefront with `authored_by = her user.id` for credit.
Normal creators (zero memberships) see zero behavior change.

**New files:**
- `src/lib/state/contextStore.ts` — Zustand slice exposing
  `{ personalCreatorId, mode, activeBrandId, memberships, membershipsLoading }`
  plus selectors `getWriteAsCreatorId()` and `getActiveBrand()`. Wires to
  `brand_memberships !inner brand_storefronts` on login. Default mode is
  `'personal'` on every session; no last-context-used persistence.
- `src/lib/queries/storefront.ts` — `useBrandIdentity(creatorId)` +
  `useBrandIdentities(ids[])` for batch byline lookups, plus
  `fetchStorefrontLooks()` for the future brand dashboard.
- `src/components/StorefrontSwitcher.tsx` — top-of-Home chip
  "Posting as [you | Brand] ▾". `ActionSheetIOS` driver. Renders `null` for
  zero-membership users so single-creator accounts are visually identical.

**Modified files (5 WRITE_AS sites + plumbing):**
- `src/lib/state/authStore.ts` — `initialize`, `login`, `signupAsCreator`,
  `promoteToCreator`, `logout`, `deleteAccount`, and the SIGNED_OUT auth
  listener all now hydrate or clear `contextStore`.
- `src/lib/state/lookStore.ts` — **`addLook` (publishLook)** resolves
  `writeAs = useContextStore.getState().getWriteAsCreatorId() ?? user.id`
  at the top, sets `creator_id = writeAs` AND `authored_by = user.id` on
  the looks insert, and passes `writeAs` to `resolveLookItemJoins` so new
  closet items created during the publish save under the same creator_id.
  `updateLook` now uses the look's own `creatorId` for item-resolution
  scope so editing a brand look stays in the brand's closet regardless of
  current mode.
- `src/app/amazon-campaigns.tsx` and `src/app/brand/[id].tsx` — both
  one-tap "add to closet" call sites now pass `writeAs` to
  `addAmazonCampaignProductToCloset` and `addAwinProductToCloset`. The
  helpers themselves are unchanged (signature preserved).
- `src/lib/utils/fetchProductInfo.ts` — `logAttempts` documented as
  intentionally PERSONAL (telemetry of *who* scraped, not closet
  ownership).
- `src/components/TryOnModelSheet.tsx` — virtual-model attempts
  documented as intentionally PERSONAL (exploratory; the published look
  routes through `lookStore.addLook` which IS context-aware).
- `src/app/(tabs)/index.tsx` — mounts `<StorefrontSwitcher />` directly
  under the header.

**Brand-aware byline:**
- `supabase/migrations/20260605220000_get_looks_by_vibe_brand_aware.sql`
  (applied to prod via Supabase MCP) — extends the public discover RPC to
  return `account_type`, `brand_name`, `brand_slug`, `brand_logo_url`
  alongside the existing creator_* fields. LEFT JOIN to
  `brand_storefronts WHERE status='active'` so archived brands disappear
  from the feed automatically.
- `src/app/(public-tabs)/feed.tsx` — `LookByVibeRow` carries the four
  new fields; `LookCard` branches on `account_type === 'partner_brand'`
  to render `brand_name` + `brand_logo_url` instead of `@creator_username`
  + `creator_photo_url`. Avatar fallback initial picks from brand_name
  when in brand mode.
- `src/app/creator-profile.tsx` — when the profile being viewed is a
  partner_brand account (resolved via `useBrandIdentity`), the username
  renders as `Golden Bear Garage` (no `@`), the avatar is the brand
  logo, and the founding-creator badge is suppressed. Stats row and
  Follow button remain — brands can still be followed.

**Auth + Amazon wiring assumed but NOT changed by this turn:** the
3-tier resolver still routes Amazon clicks via `creators.amazon_tracking_id`
on the storefront's row (= `styledinmotio-goldenbear-20`). Nothing in this
turn touches the click pipeline.

**Out of scope of this turn (separate work):**
- Public `/brand/<slug>` shopper landing page — needs OG tags + featured
  Collabs slot.
- Snapshot-copy logic for cross-closet items in brand context (Kerri pulling
  one of her personal pieces into a Golden Bear look should copy under the
  storefront with affiliate_url set to NULL so `/api/shop` re-stamps with
  the brand tag — design doc §"Snapshot re-stamping").
- Brand byline on `src/app/(tabs)/shop.tsx` and the Home `LookCard`. (Home
  shows the user's own looks — byline question doesn't apply. Shop's grid
  may need an update if it ever surfaces other creators' looks.)
- Creators-web `/admin/storefronts` section — spec written at
  `business/admin-storefronts-vibecode-prompt.md` (one-shot Vibecode
  prompt, ready to paste).

**Pre-existing typecheck error noted, NOT introduced by §6f but FIXED in §6g
below:** `src/app/collage-builder.tsx:226` referenced `s.fetchLookById` which
was never declared on `lookStore.LookStore`. tsc reported this as the only
error in the codebase pre-fix. Cleared in §6g.

### 6n. In-app follow system — DB-backed, Following feed, discovery, social prompt (DONE)
Replaces the local-only Zustand follow store with a real DB-backed follow
graph so follows persist cross-device, drive a "Following" feed, encourage
discovery, and surface a correct follower count. Six phases.

**DB** (applied via Supabase MCP; mirrored to migrations):
- `20260609013000_in_app_follows_system.sql` — `follows` table
  (follower_id → auth.users, creator_id → creator_profiles, PK both),
  RLS own-rows only, `creator_profiles.app_follower_count` +
  `bump_app_follower_count()` trigger (INSERT/DELETE), and the
  `get_following_feed(limit, offset)` RPC (same column shape as
  get_looks_by_vibe so the masonry card renders unchanged).
- `20260609014000_get_suggested_creators.sql` — `get_suggested_creators(limit)`
  RPC: real creators (not brands) with ≥1 published look, excluding self +
  already-followed, ranked by app_follower_count then look count.
- Trigger verified: insert → count 1, delete → count 0.

**Store** — `lib/state/followStore.ts` fully rewritten. Was Zustand +
AsyncStorage keyed by email (per-device, lost on reinstall, wrong counts).
Now: `followerId` + `followedIds[]` cache, `hydrate(followerId)` loads from
DB on auth, `toggleFollow(creatorId)` is optimistic with insert/delete +
revert-on-error and returns the resulting state (so callers know a fresh
follow), `isFollowing(creatorId)` sync, `clear()` on logout.
`authStore` hydrates follows on init/login/signup/promote and clears on
logout/delete/SIGNED_OUT.

**Follower counts** — switched everywhere from the (broken, per-device)
followMap count to `creator_profiles.app_follower_count`:
- `profileStore` maps `appFollowerCount` (creator-profile reads it).
- New `useAppFollowerCount(creatorId)` hook in `creatorStats.ts` used by
  creator-stats, creator-analytics, Home `(tabs)/index.tsx`, and
  creator-account.

**Following feed** — `feed.tsx` gains a For You / Following segmented toggle.
Following calls `get_following_feed`; empty state ("Follow creators to fill
your feed" + suggestions) shows when the shopper follows nobody. Featured
brands + Creators-to-follow rails show in For You only.

**Discovery** — `components/CreatorsToFollowRail.tsx`: horizontal rail of
suggested creators (avatar, @username, follower count, one-tap Follow).
Mounted on the For You feed under Featured brands AND inside the
Following-empty state ("Start with these"). Renders null when no
suggestions.

**Cross-social prompt** — `FollowPromptSheet` (the existing "Follow them
everywhere" IG/TikTok/YouTube/Pinterest deep-link sheet) now also fires from
the Shop This Look sheet on a fresh follow, not just the creator profile.

**Phase 7 — guest sign-up nudge.** A not-signed-in viewer can reach a look
via a shared `/look/<id>` deep link (deep-link entry skips the auth
redirect). New `components/SignUpNudgeSheet.tsx` — a polished modal
("Create a free account to follow…", CTA → `/public-signup`). Gated the 3
follow call sites: tapping Follow while signed out shows the nudge instead
of a silent no-op. Note: the ItemListSheet Follow button previously required
`publicUserId` to render (hid it for guests) — dropped that requirement so
guests now SEE Follow and get nudged.

Verified: 0 typecheck errors across all touched files
(`bunx tsc --noEmit`). Files: followStore, authStore, profileStore,
creatorStats, creatorLooks, ItemListSheet, creator-profile, creator-stats,
creator-account, (tabs)/index, creator-analytics, (public-tabs)/feed, plus
new CreatorsToFollowRail + SignUpNudgeSheet.

### 6o. Feed follow-flow polish — 3 fixes from Nicole's screenshots (DONE)
Follow-up to 6n after Nicole tested the Following tab. Three issues:

1. **"Back to my creator dashboard" pill now mirrors the creator-Home
   "See what shoppers see" button.** Was a small grey-text + grid-icon chip
   (alignSelf flex-start, easy to miss). Now the same full-width outlined
   pill language as Home: white fill, 1.5px ink border, leading
   `LayoutDashboard` icon, trailing `ChevronRight`, `justify-between`. The
   two surfaces are deliberately reciprocal (Home → shopper, Feed → back),
   so they now look like a matched pair. Converted from a StyleSheet
   function-form `style` to NativeWind `className` (the app's preferred
   Pressable pattern) and deleted the now-dead `feedModePillStyles` block.

2. **Fixed the overlapping empty state on the Following tab.** The generic
   floating "No looks found / Try removing a filter or clearing your search"
   overlay (an `absolute`, `top: 240` element) was stacking *on top of* the
   "Follow creators to fill your feed" card — the messy overlap in Nicole's
   screenshot. Now suppressed whenever the Following tab is already showing
   its own in-header empty card (`feedMode === 'following' && followedIds
   .length === 0`), via a new `showEmptyOverlay` guard. Also made the
   overlay copy mode-aware: in Following mode it reads "No looks yet / The
   creators you follow haven't posted any looks yet" instead of the
   filter-centric For-You copy (Following has no filters to remove).

3. **Fixed "follow a creator → no looks appear."** The `following-feed`
   infinite query used a static key `['following-feed']` and never refetched
   when the follow set changed, so after following someone the grid stayed
   empty. Fix is race-free: `followStore.toggleFollow` now calls
   `queryClient.invalidateQueries({ queryKey: ['following-feed'] })` **after**
   the DB insert/delete resolves (not on the optimistic `followedIds` flip,
   which would race the insert and read a stale, empty follow set). To let a
   non-React Zustand store reach the client, extracted the `QueryClient` from
   `_layout.tsx` into a shared `lib/queryClient.ts` singleton. Also smoothed
   the post-follow beat: `isLoadingInitial` now treats an in-flight fetch
   with an empty grid as "loading" so you see the spinner, not a flash of the
   empty state, while the refetch lands.

New: `lib/queryClient.ts`. Changed: `_layout.tsx`, `lib/state/followStore.ts`,
`(public-tabs)/feed.tsx`. Verified: `bunx tsc --noEmit` → 0 errors (run on
the remote). Backups: `~/styled-in-motion-edits/2026-06-09-feed-follow-polish/`.

### 6p. Saved items — nailed down end-to-end, now DB-backed (DONE)
Nicole: "The saves for Shoppers do not respond or save the items. That flow
needs to be fully nailed down." It was broken in three layered ways:

1. **Dead bookmark (reactivity).** The Shop-This-Look sheet read the saved
   store's *functions* (`toggleSaveItem`/`isItemSaved`) but never subscribed
   to the `savedItems` array, so tapping the bookmark wrote to storage yet
   never re-rendered — the icon never filled, so it felt like a no-op. Fixed
   by subscribing to `savedItems` and deriving an O(1) `savedIdSet` for the
   per-item fill.
2. **Saves went nowhere.** The Saved tab's "Items" view showed items *derived
   from liked looks* and **nothing read `savedItemsStore`**. So a bookmark had
   no destination. Rewired the Items view to render the shopper's actual
   bookmarked items (with price + an unsave control), and rewrote the empty
   state to point at the bookmark.
3. **Local-only (inconsistent + loses purchase intent).** `savedItemsStore`
   was Zustand + AsyncStorage while likes/follows are DB-backed — so saves
   were per-device and died on reinstall. Promoted it to DB-backed, mirroring
   likeStore/followStore.

**DB** — new `saved_items` table (migration
`20260609180000_saved_items_table.sql`, applied via MCP + mirrored): id pk,
user_id (FK auth.users cascade), item_id (creator_items.id — dedupe key),
look_id / look_item_id / creator_id for click attribution, plus a denormalized
snapshot (name/brand/price/photo/emoji/link/affiliate/look_photo) so the Saved
tab renders + shops without a join. `unique(user_id, item_id)`, RLS own-rows
select/insert/delete (verbatim from the `likes` policy), indexes on
user_id + item_id. Verified end-to-end: structure, grants match `likes`
(authenticated/anon), unique dedupe fires, and a two-user RLS test proved
isolation — A sees own (1), B sees A (0), B cannot delete A's row
(survives = 1) — all rolled back.

**Store** — `lib/state/savedItemsStore.ts` fully rewritten: `userId` +
`savedItems[]` cache + `_hydrated`; `hydrate(userId?)` loads from the table;
`toggleSaveItem(item, lookId, lookPhotoUri, creatorId?)` optimistic
insert/delete + revert-on-error (23505 = already-saved treated as success);
`isItemSaved`; `removeSavedItem` (DB delete, used by the Saved tab unsave);
`clear()`. No AsyncStorage — DB is the source of truth, hydrated on auth.

**Auth** — `authStore` hydrates saved items next to every
syncLikedIds/followStore.hydrate (6 sites) and clears next to followStore.clear
(3 sites: logout, deleteAccount, SIGNED_OUT).

**Guest gate** — bookmarking while signed out now opens the SignUpNudgeSheet
("Create a free account to save items") instead of a silent no-op; the sheet's
context is now dynamic so Follow and Save each get the right headline.

Changed: `lib/state/savedItemsStore.ts` (rewrite), `lib/state/authStore.ts`,
`components/ItemListSheet.tsx`, `(public-tabs)/saved.tsx`. Verified:
`bunx tsc --noEmit` → 0 errors (remote). Backups:
`~/styled-in-motion-edits/2026-06-09-saved-items/`.

### 6q. Save the whole look — DB-backed, parallel to saved items (DONE)
Nicole: "There is no way to save the whole look — Only items." The Shop sheet
had a like heart (which writes to `likes`), but two things made whole-look
saving fail in practice:
- **Affordance:** items save with a *bookmark*; the look only had a *heart*,
  which reads as "like," not "save."
- **Function:** Saved → Looks rendered `lookStore.looks ∩ likedLookIds`, and
  `lookStore.looks` only holds the signed-in creator's OWN looks. A shopper
  who liked another creator's look saw it in Saved only until the next app
  restart (when the own-looks fetch overwrote the array) — then it silently
  vanished.

Fixed by giving looks the same DB-backed, self-contained save the items got:

**DB** — new `saved_looks` table (migration
`20260609190000_saved_looks_table.sql`, applied via MCP + mirrored): id pk,
user_id (FK auth.users cascade), look_id (dedupe key), creator_id, plus a
denormalized byline + cover snapshot (title, cover_photo_url, item_count,
creator_name, creator_photo_url, is_brand, brand_name, brand_slug,
brand_logo_url). `unique(user_id, look_id)`, RLS own-rows select/insert/delete,
indexes on user_id + look_id. Verified: structure, grants match likes
(7 to authenticated), and a two-user RLS test proved isolation (A sees own=1,
B sees A=0, B can't delete A=1) — all rolled back.

**Store** — new `lib/state/savedLooksStore.ts` mirroring savedItemsStore:
`hydrate`, `toggleSaveLook(snapshot)` (optimistic + revert), `isLookSaved`,
`removeSavedLook`, `clear`. No AsyncStorage — DB is source of truth, hydrated
on auth (6 sites) + cleared on logout (3 sites) in authStore.

**Sheet** — `ItemListSheet` header now has a **Save / Saved** bookmark pill
(rose, matching the item bookmarks) beside the like heart, gated `!isOwnLook`.
It snapshots the look's byline (creator/brand, resolved) at save time so Saved
renders without a live lookup. Guests get the sign-up nudge ("to save looks").
The heart stays as the public *like* — like and save are now distinct
(Instagram/Pinterest model).

**Saved → Looks** — `(public-tabs)/saved.tsx` Looks view now reads
`savedLooksStore` snapshots instead of `lookStore.looks ∩ likes`, so saved
looks render reliably across restart + device. Opening a saved look fetches
its full items on demand via `fetchLookById` (brief spinner on the card).
Unsave is a filled bookmark (was a heart). Empty-state copy points at the new
Save control. Removed the now-dead profile/brand byline machinery (the
snapshot carries the byline).

New: `lib/state/savedLooksStore.ts`. Changed: `lib/state/authStore.ts`,
`components/ItemListSheet.tsx`, `(public-tabs)/saved.tsx`. Verified:
`bunx tsc --noEmit` → 0 errors (remote). Backups:
`~/styled-in-motion-edits/2026-06-09-save-look/`.

### 6r. Save-look fix — moved out of the gesture header (DONE)
Nicole (screen recording): "Saved looks are not working also the heart at top
of the look is inconsistently showing and seems cluttered." Diagnosed from the
DB: her account had **3 saved_items but 0 saved_looks AND 0 likes**, while the
whole `saved_looks` table was empty. The tell: the per-item bookmarks (which
live in the scrollable body) wrote fine; everything in the **sheet header** —
the like heart and the Save pill — registered **no** taps. The header is
wrapped in the swipe-to-dismiss `GestureDetector`, which on iOS swallows taps
on its small child buttons (the same class of bug as the earlier byline tap).
So nothing in the header was actually firing.

Fix — three parts:
1. **Moved Save out of the header into the body.** Removed the header's
   Save/like pills entirely and added a prominent **"Save this look" / "Saved
   to your looks"** bar directly under the cover photo, inside the ScrollView
   (a proven-reliable tap zone — it's where the working item bookmarks live).
   Heart icon (matches the Saved tab), rose fill when saved. Writes
   `saved_looks` → Saved → Looks, keeps the public like in sync, gates guests
   with the sign-up nudge. Hidden on your own look (creator share tools show
   instead).
2. **Decluttered + de-flaked the header.** The header action row is now just
   **Share** (no heart, no second pill), so nothing reads as cluttered and
   there's no dead/inconsistent header control.
3. **Fixed a rendering bug** in the Saved → Looks empty copy: it literally
   showed `—` (an em-dash that got stored as the escape sequence in JSX
   text). Reworded to plain text and pointed it at the new Save control.

Changed: `components/ItemListSheet.tsx`, `(public-tabs)/saved.tsx`. Verified:
`bunx tsc --noEmit` → 0 errors (remote). Backups:
`~/styled-in-motion-edits/2026-06-09-save-look-fix/`.

**Follow-up (6r.1) — the "Save this look" pill rendered unstyled** (heart
stacked above the text, left-aligned, no pill) and stayed that way after a
full reload. Root cause: I'd built it as a `<Pressable>` styled with
StyleSheet via the function-form `style={({pressed}) => [...]}` — the exact
"invisible button" trap documented in `mobile/CLAUDE.md` / the ui-consistency
memory (StyleSheet/function-form on a Pressable doesn't render in this
NativeWind build; that's *why* `PillButton` exists). Replaced it with
`<PillButton variant={saved ? 'primary' : 'outline'} size="sm" icon={<Heart/>} />`
inside a `className="flex-row justify-end"` row, so it's a proper compact pill
on the **right** with the heart **inline** (Nicole's polish ask), and it
actually renders. Deleted the dead `saveLookBar` StyleSheet block. Verified
tsc 0 errors. Backup: `~/styled-in-motion-edits/2026-06-09-save-look-polish/`.

### 6s. Pinterest share now saves the cover photo to the camera roll (DONE)
Nicole: sharing a look to Pinterest from the creator side didn't drop the
cover photo into the camera roll the way Instagram and TikTok do. Those flows
call `savePhotoToLibrary` / `savePhotosToAlbum` before opening the app;
`shareToPinterest` deliberately skipped it (it relies on Pinterest pulling the
image from the `media` URL param). But the Universal-Link hand-off to the
Pinterest app can drop that pre-loaded image on a cold start, leaving the
creator with no photo to add. Added a best-effort `savePhotoToLibrary(look
.photoUri)` at the top of `shareToPinterest` (handles its own permission +
remote→local download; wrapped in try/catch so a failed save never blocks the
share) — so Pinterest now matches IG/TikTok. Changed:
`lib/utils/shareToPinterest.ts`. Verified tsc 0 errors (remote). Backup:
`~/styled-in-motion-edits/2026-06-09-pinterest-save/`.

### 6t. Pinterest Connect — can't switch accounts / "Log out" hangs (DONE)
Nicole, in creator-account → Connect Pinterest (`PinterestConnectCard`, the
server-managed OAuth, separate from the share above): the OAuth "Authorize
app" screen auto-logged her in as the wrong Pinterest account, and Pinterest's
in-flow "Not your account? Log out" link hung on a blank page — so she
couldn't pick a different account. Cause: `WebBrowser.openAuthSessionAsync`
was called without `preferEphemeralSession`, so iOS's ASWebAuthenticationSession
reused Safari's shared Pinterest cookies (auto-login), and Pinterest's logout
redirect doesn't resolve inside that session. Fix: pass
`{ preferEphemeralSession: true }` — the auth session now uses a private cookie
store, so every connect starts with a fresh Pinterest login and the creator
chooses which account to link (no auto-login, no need to use the broken "Log
out"). One-line option, no flow/redirect changes. Changed:
`components/PinterestConnectCard.tsx`. Verified tsc 0 errors (remote). Backup:
`~/styled-in-motion-edits/2026-06-09-pinterest-account-switch/`.

### 6m. Per-item rank + per-network breakdown (DONE — closes Pass 2 stats)
Two server-side RPCs + paired surfaces on iOS + creators-web. Closes
the last Pass 2 stats item (#67) so the creator analytics screen now has
clicks/$ at three granularities: per-look (§6h), per-item (this turn),
and per-network (this turn).

**RPCs** (migration
`supabase/migrations/20260608234000_creator_perf_and_network_rpcs.sql`,
applied to prod via Supabase MCP):
- `creator_item_performance(p_creator_id uuid)` — every closet item
  ranked by clicks with looks-featured-in count, $ earned, and
  commission count. Joins `creator_items × click_events × look_items ×
  commissions` in three CTEs + a left-join roll-up.
- `creator_clicks_by_network(p_creator_id uuid)` — buckets clicks by
  `affiliate_network` ('amazon' | 'awin' | 'cj' | 'unaffiliated'). The
  unaffiliated bucket is the commission-leakage signal (merchants we
  don't yet wrap).

Both are STABLE LANGUAGE SQL + SECURITY DEFINER + defensively gate via
`auth.uid() = p_creator_id` in the WHERE clauses so passing another
creator's id returns zero rows even though SECURITY DEFINER would
otherwise bypass RLS. EXECUTE granted to authenticated only.

**iOS**:
- New `mobile/src/lib/queries/creatorPerformance.ts` — React Query
  wrappers `useCreatorItemPerformance(creatorId)` and
  `useCreatorClicksByNetwork(creatorId)`. 5-min staleTime each.
- `mobile/src/app/creator-analytics.tsx` — two new sections inserted
  right after "Top Looks": **"Top Items"** (top 5 with photo, brand,
  click count, looks featured in, earnings) and **"Traffic by
  Network"** (one row per active network with click count + earnings).
  Both render only when there's data, so a fresh creator's screen
  doesn't read as a wall of zeros.

**creators-web `/earnings`**:
- Added `fetchItemPerformance()` + `fetchClicksByNetwork()` in
  `lib/earnings/queries.ts` calling the same RPCs.
- "Traffic by network" tile row (responsive 2-4 cols) inserted above
  the existing "Performance by look" table.
- "Performance by item" sortable-feel table inserted below the
  traffic tile: thumb | item + category | brand | in looks | clicks
  | sales | $ earned. Top 25 by clicks; "Full export coming soon"
  footer when truncated.
- Both surfaces gate on data > 0.

**Verified**: 0 typecheck errors on iOS (`bunx tsc --noEmit`) and
creators-web (`npm run typecheck`). Pushed to main as commit `e5999f7`;
Vercel auto-deploy in flight at dpl_6AyCBxsysR159uHxWW8gGhCjkHBo.

### 6l. CJ auto-roster + logos + commission bridge (DONE — closes the CJ loop)
Three pieces shipped on top of §6k (CJ click wrap) so the CJ commission
lifecycle is now fully end-to-end automated.

**(a) cj-advertisers-sync edge function** — pulls Nicole's joined advertisers
from CJ's Advertiser Lookup REST API (XML response, parsed via regex) and
upserts into `cj_merchants`. Replaces manual roster entry. Scheduled via
`pg_cron` daily at **05:00 UTC** (job id 12), alongside
`rakuten-advertisers-sync-daily` which runs at the same time. Both hit
different external APIs so pg_cron's parallel execution is fine.

Versions shipped this session:
- v1: initial; mis-mapped CJ's `account-status='Active'` as legacy
  `in_business`. Flipped all 9 rows to status='paused'. ~2 min outage
  until restored via SQL.
- v2: normalized status to accept both `Active` and `in_business`.
- v3: added Clearbit Logo API → host no longer resolves (sunset).
- v4: swapped to icon.horse, verified live for all 9 active merchants.
  **Current.**

cj_merchants.logo_url now populated for all 9 (icon.horse format). The
`affiliate_merchants` view (UNION over awin_merchants + rakuten_merchants
+ cj_merchants) surfaces them; iOS Brands tab reads from that view, so no
iOS code change required.

**(b) Bridge: cj_commissions → commissions** —
`supabase/migrations/20260608233000_bridge_cj_commissions_to_commissions.sql`
adds a `bridge_cj_commission_to_commissions()` trigger function and an
AFTER INSERT OR UPDATE trigger on `public.cj_commissions`. Each CJ
commission record is translated to a row in the unified `commissions`
table so `/earnings` (creators-web) and `useCreatorEarnings`/`useLookPerformance`
(iOS + web hooks) surface CJ revenue with zero per-network branching.

Resolution chain:
```
cj_commissions.shopper_id (text)
  ::uuid → click_events.id
         → click_events.creator_id, look_id, item_id
         + cj_merchants.cj_advertiser_id → merchant_domain
  → commissions row (affiliate_network='cj', upsert on
    affiliate_transaction_id = commission_id)
```

Status mapping (action_status × validation_status × locking_date):
| Input | commissions.status |
|---|---|
| locking_date IS NOT NULL | paid |
| validation_status='rejected' | reversed |
| correction_reason + rejected/reversed | reversed |
| validation_status IN (approved, validated) | confirmed |
| else | pending |

Share convention: `creator_share = commission_total` (100% to creator),
`platform_share = 0`. Matches lib/earnings/mutations.ts:148. Change in
the trigger function when policy changes.

Skip rules: when `shopper_id` is NULL or not a UUID, the trigger returns
without writing to commissions (preserves raw row in cj_commissions for
audit but doesn't pollute the unified ledger with un-attributable revenue).

Verified end-to-end via SQL smoke test:
- INSERT → 'confirmed' status, creator_id resolved via click_events, merchant_domain from cj_merchants
- UPDATE (locking_date set) → 'paid' status, paid_at stamped, confirmed_at preserved
- Smoke test rows then cleaned up; both tables empty as of 2026-06-08 23:09 UTC.

**(c) Logo update** — cj-advertisers-sync re-run after deploy to populate
icon.horse logo URLs on all 9 active CJ merchants. Real run, not dry.

### 6k. CJ click wrap (DONE: outbound side)
With CJ already approved + 9 active merchants seeded in `affiliate_merchants`
(camper.com / cashmereboutique.com / quay.com / mytheresa.com / rebag.com
/ tiktok.com / awbridal.com / modlily.com / trueclassictees.com) and the
cj-commissions-sync edge function already pulling commission records nightly,
the missing piece was the OUTBOUND click wrap. Now wired.

**What ships:**
- `supabase/migrations/20260608230000_click_events_cj_advertiser_id.sql` —
  adds `click_events.cj_advertiser_id text` + partial index. Applied to
  prod via Supabase MCP.
- `backend/src/routes/shop-redirect.ts` — three additions:
  - **CJ helpers** (top of file): `CJ_WRAP_HOSTS` set, `CJ_PID_IOS` (101740603)
    + `CJ_PID_WEB` (101761822) constants, `isCjWrappedUrl()`, `pickCjPid()`,
    `buildCjDeepLink()` (DLG-format URL builder), `hostnameNoWww()`.
  - **CJ detection** in the request handler: after Amazon/Awin checks fall
    through, query `affiliate_merchants` where `network='cj' AND status='active'`
    and `(domain=host OR alt_domains @> array[host])`. If matched, capture
    `cj_advertiser_id` + `domain` for the wrap + insert.
  - **CJ wrap** in the redirect computation: build
    `https://www.anrdoezrs.net/links/{PID}/type/dlg/sid/{clickEventId}/{encoded-target}`.
    PID picked by source — `src=ios` → 101740603 (the CJ "Mobile App"
    promotional property), everything else → 101761822 (Website).
  - **click_events insert**: extends `was_affiliated` + `affiliate_network`
    + `merchant_domain` branches with CJ, plus persists the new
    `cj_advertiser_id` column.

**Reconciliation chain (end-to-end):**
1. Shopper taps a camper.com link → `/api/shop` resolves CJ adv 6316816
2. Outbound URL: `anrdoezrs.net/links/101761822/type/dlg/sid/<UUID>/<camper-url>`
3. CJ records the click against PID 101761822 with shopperId=<UUID>
4. When the commission posts, cj-commissions-sync (existing EF) pulls the
   record and writes `cj_commissions.shopper_id = <UUID>`
5. Reconciliation: `cj_commissions JOIN click_events ON id::text = shopper_id`
   → reach creator_id, look_id, item_id, creator_share

**Pending in pass 2 (deferred to #69):**
- Bridge `cj_commissions` rows into the unified `commissions` table so the
  existing creators-web `/earnings` and iOS earnings hooks see CJ revenue
  alongside Amazon + Awin without per-network branching. Likely a trigger
  on cj_commissions INSERT that resolves shopper_id → click_event_id and
  upserts into commissions.
- Verification click against one of the 9 active CJ merchants once the
  backend deploys, to confirm the DLG URL routes correctly and a
  click_events row lands with affiliate_network='cj' +
  cj_advertiser_id populated.

### 6j. Attribution audit + amazon_tag_source column (DONE: pass 1 of 2)
Audited every entry-point × affiliate-network combination against live
click_events. Two agent-flagged "broken" alarms turned out to be false
positives — Amazon attribution IS working (265 affiliated clicks in last
14 days), Awin is working (17 clicks), and the column-mismatch claim was
wrong (both `amazon_own_tag_enabled` AND legacy `amazon_use_own_tag`
exist on creator_profiles; `creators.amazon_tracking_id` exists and is
populated; shop-redirect.ts correctly reads all three).

**Real gaps identified:**
1. 45 of 331 last-14-day clicks landed against merchants with no network
   wrapping (Rakuten / CJ / Skimlinks merchants we don't yet have
   account-side approval to wrap). Commission opportunity. Code lift is
   moderate once approvals land; deferred to pass 2.
2. Per-click Amazon tier (own / creator_subtag / master) was not
   persisted, so post-hoc reconciliation couldn't tell which tag was
   actually stamped if a creator changed their tag mid-window. **Fixed
   in this pass.**
3. Creator self-traffic from creators-web: no current /api/shop callers
   in the creators-web repo (closet items + look pages link internally
   to `/closet/[id]` and `/looks/[id]`, not via shop-redirect). Backend
   was nonetheless extended to accept `?src=creator` for future use when
   any shopper-style action gets added to creators-web.

**Files touched:**
- `supabase/migrations/20260605230000_click_events_amazon_tag_source.sql`
  — adds `amazon_tag_source text` with CHECK constraint
  ('own'|'creator_tracking_id'|'master') + partial index. Applied to
  prod via Supabase MCP.
- `backend/src/routes/shop-redirect.ts` — extends explicit-source
  allow-list with `'creator'`; persists `amazon_tag_source` on the
  click_events insert (already computed by the existing
  `resolveAmazonTag` helper; just wasn't being written).

**Pass 2 (deferred, separate session):**
- CJ + Rakuten URL-wrap stubs (gated by network ID config; trivial code
  lift once merchant approvals roll in).
- iOS-side surfacing of clicks + $ per look + per item (parallel to the
  creators-web Pass 1 work below).

### 6i. Shopper polish pass (DONE)
Polish pass on the shopper flow after Nicole flagged that look detail
showed "by Creator" generically + you couldn't favorite a creator from
a look. Touches 4 files; brings the shopper journey up to launch quality.

**`components/ItemListSheet.tsx`** — the "Shop This Look" bottom sheet
that powers the look detail page and every saved-card / search-card tap.
- Generic `"by Creator"` fallback replaced with a brand-aware byline
  showing avatar (or initial), real display name, tappable to
  `/creator-profile` for humans and `/storefront/<slug>` for partner
  brands.
- New `Follow` pill in the byline row — uses the existing
  `useFollowStore`, shows ink-fill "Follow" → white-outline "Following"
  with checkmark. Suppressed for brand profiles (they use the storefront
  tab) and for the creator viewing their own look.
- Profile lazy-fetch via `useProfileStore.fetchProfile` on mount when
  the cache misses — fixes the deep-link-from-share case where the
  profile cache hadn't been warmed.
- Affiliate disclosure copy now uses the real display name instead of
  the generic placeholder ("As an Amazon Associate, Kerri Daly earns…").

**`app/(public-tabs)/saved.tsx`** —
- Tappable creator/brand byline below each saved-look card title.
  Avatar (or initial) + display name, routes to the right profile
  surface. Brand-aware via `useBrandIdentities`.
- Empty states (`saved-looks-empty`, `saved-items-empty`) replaced
  with polished card layouts: serif heading, body copy explaining how
  to populate, and a CTA pill ("Browse the Feed") on the looks-empty
  state. Feels intentional rather than "no data."

**`app/(public-tabs)/search.tsx`** —
- `renderCard` is now brand-aware. Cards for partner_brand looks show
  the brand mark + brand name; tap routes to `/storefront/<slug>`.
  Regular creator cards keep the `@username` + creator-profile route.
- Empty states (no-results + no-filtered-results) use the same
  polished card pattern as saved.

**Net effect:** the shopper opens any look (deep link, share, search,
saved tile) and immediately sees who built it, can follow them in one
tap, and the path to the brand storefront vs the creator profile is
correct based on account_type. Empty states feel composed.

---

### 6h. Shopper-facing storefront surfaces (DONE)
Closes the gap noted in §6f's out-of-scope list: with §6e + §6f shipped, a
shopper couldn't actually see that Golden Bear Garage exists. This turn
ships the four discoverability surfaces.

**New files:**
- `src/app/storefront/[slug].tsx` — public storefront landing page.
  Hero (logo + name + brand_story) → promo code card (if set) →
  fulfillment chips (Etsy / eBay / Shopify buttons from
  `brand_storefronts.fulfillment`) → "Looks by <brand>" 2-col grid via
  `useStorefrontLooks`. Empty state ("New collection coming soon")
  renders cleanly when the brand has 0 published looks so the surface
  ships before any content exists.
- `src/components/BrandsRail.tsx` — horizontal scroller of active partner
  brand logos + name. Mounts on the discover feed above the look grid.
  Renders `null` when `useActiveStorefronts` returns empty so the feed
  layout collapses for everyday creators.
- `src/app/(public-tabs)/brands.tsx` — full shopper "Brands" tab.
  2-col card grid of every active partner_brand storefront. Pull-to-
  refresh, empty state, shared cache with BrandsRail.

**Modified:**
- `src/lib/queries/storefront.ts` — adds
  `useActiveStorefronts()` (list active partner brands, excludes test +
  archived), `useStorefrontBySlug(slug)` (full detail for the landing
  page; returns null for non-active so paused brands stop accepting
  shopper traffic without breaking deep links), and the existing
  `fetchStorefrontLooks` now has a `useStorefrontLooks` React Query
  wrapper.
- `src/app/(public-tabs)/feed.tsx` — (a) imports + mounts
  `<BrandsRail />` between the occasion chips and the "For You" heading;
  (b) brand byline on the discover look card is now a `Pressable` that
  routes to `/storefront/<brand_slug>`. Implementation note: the
  byline overlay's `pointerEvents` switched from `"none"` to
  `"box-none"` so the inner Pressable can intercept while non-
  interactive areas still fall through to the card's open-look handler.
  Brand byline tap target only navigates when `account_type='partner_brand'`
  AND `brand_slug` is set — regular creator bylines stay non-tappable.
- `src/app/(public-tabs)/_layout.tsx` — registers the new "Brands"
  tab between "Discover" and "Try On" for both web fallback and
  iOS native-bottom-tabs. SF Symbol: `storefront.fill`.

**Behavior delta:** with this turn shipped, a brand-new shopper sees
"Brands" in the tab bar AND a Featured Brands rail on the feed even
before any GBG look exists. Tapping either → the GBG landing page with
brand story, logo, promo (when set), and an empty-state for looks. The
moment Kerri publishes the first look from her iOS context-switcher,
the look appears in the discover feed with a tappable GBG byline AND
on the storefront page. End-to-end shopper journey works without any
further build.

**Out of scope of this turn:**
- Brand-scoped analytics (impressions on the rail, taps to the landing
  page, drill-through clicks). Currently we have click_events for the
  shop-redirect pipeline; per-storefront-page analytics is a v1.1 add.
- Promo-code copy-to-clipboard interaction on the storefront page (just
  displayed, not interactive). Tradeoff: shoppers manually transcribe
  the code when checking out on Amazon. Cheap to add later.
- Brand byline on `app/(tabs)/index.tsx` LookCard (Home) — Home shows
  the user's own looks, so the brand byline question doesn't apply.

### 6g. `lookStore.fetchLookById` — single-look fetcher (DONE)
Implements the previously-undeclared selector that `collage-builder.tsx`
needs to resolve a server-seeded draft that hasn't entered any local slice.
- Interface: `fetchLookById(lookId: string) => Promise<Look | null>`.
- Implementation: `select *, look_items(…)` with `.maybeSingle()` (null on
  miss, no throw); maps via the canonical `rowToLook`; hydrates the result
  into `state.looks` if published (and seeds the like count), or into
  `state.draftLooksByCreator[creator_id]` if it's an unpublished draft.
  Archived rows are returned without slice hydration.
- Verified: `bunx tsc --noEmit` on remote → 0 errors, exit code 0.
- Single touched file: `src/lib/state/lookStore.ts`. No callsite changes
  needed — `collage-builder.tsx` was already calling it.

### 6e. Brand storefronts v1 — Golden Bear Garage launch pour (DONE: schema + seed)
Foundational schema + RLS + seed data for the partner-brand storefront program. Golden
Bear Garage (Billy Gorey, goldenbeargarage@gmail.com) is the first launch partner; Kerri
is his stylist. A "Test Brand" twin (Jade=owner, Mia=stylist, `is_test=true`) seeded in
parallel so QA flows have a stable fixture matched to the Jade/Mia test pattern.

Companion design docs (in chat, not in repo):
- `golden-bear-collab-design.md` (Billy/Kerri partnership shape)
- `partner-brand-access-and-stylist-login.md` (membership + context-switch model)

**Migrations applied to prod via Supabase MCP on 2026-06-05** (mirrored to
`supabase/migrations/`):
- `20260605210000_brand_storefronts_memberships.sql` — adds
  `creator_profiles.account_type` ('creator'|'partner_brand') + `is_admin` boolean;
  creates `brand_storefronts` (slug, brand_story, logo_url, commission_pct CHECK 0-100,
  promo_code, fulfillment jsonb, contact_email, status, updated_at trigger) +
  `brand_memberships` (role 'owner'|'stylist'|'analyst', status, assigned_by, unique
  per (creator_id, brand_id)); adds `looks.authored_by` + `creator_items.authored_by`;
  enables RLS and adds policies:
    - `brand_storefronts_select_public` (status='active'), `_select_members`, `_admin_all`
    - `brand_memberships_select_self`, `_admin_all`
    - `looks_select|insert|update|delete_storefront_*` (stylists only for writes)
    - `creator_items_insert|update|delete_storefront_stylist`
- `20260605210500_brand_storefronts_is_test.sql` — `is_test` boolean + partial index
  so the QA Test Brand is cleanly excludable everywhere without name-matching hacks.
- `20260605211000_seed_golden_bear_garage.sql` — promotes Nicole + Kerri to
  `is_admin=true`; creates synthetic auth.users + creators + creator_profiles rows for
  the GBG storefront content account (amazon_tracking_id `styledinmotio-goldenbear-20`,
  account_type='partner_brand') and the Test Brand twin (`styledinmotio-testbrand-20`,
  is_seed=true); creates brand_storefronts rows (commission_pct=15) + brand_memberships
  for both brands.

Storefront content account ids (stable, hand-picked for seed):
- Golden Bear Garage: `b9909999-0001-4000-8000-000000000001`
- Test Brand: `b9909999-0002-4000-8000-000000000002`
- GBG brand_storefronts.id: `a0a00001-9001-4001-8001-000000000001`
- Test Brand brand_storefronts.id: `a0a00002-9002-4002-8002-000000000002`

**Manual remaining at launch:**
- Upload GBG logo binary to Supabase Storage at the path
  `profile-photos/b9909999-0001-4000-8000-000000000001/profile.jpg` (the path is
  already wired into both `brand_storefronts.logo_url` and
  `creator_profiles.photo_url` — until the binary is there the brand page shows a
  broken avatar).
- (Done 2026-06-05): Billy created `styledinmotio-goldenbear-20` at Amazon
  Associates and the tag is now wired in two places: (a) the GBG storefront
  content account (`b9909999-…`) on both `creators.amazon_tracking_id` and
  `creator_profiles.amazon_associates_tag` with `amazon_own_tag_enabled=true`
  — covers all looks Kerri styles in storefront context; and (b) Billy's
  personal creator row (`94d360ab-…`) on `creators.amazon_tracking_id` — so
  anything Billy himself publishes also flows to the GBG Associates account
  via tier-2 resolution. Net: no Billy-flavored Amazon traffic ever falls
  through to the master tag.
- (Done 2026-06-05): GBG logo uploaded to Supabase Storage at the wired path
  `profile-photos/b9909999-0001-4000-8000-000000000001/profile.jpg` (1254×1254
  JPEG, 248 KB). Both `brand_storefronts.logo_url` and
  `creator_profiles.photo_url` were already pointed at this URL by the prior
  content pass — broken-avatar state cleared.
- (Done 2026-06-05): GBG `payout_email` set to `goldenbeargarage@gmail.com`
  (`payout_method='paypal'` was already set by the prior content pass). Billy's
  complementary-item affiliate balance accrues here → SiM pays him.

**Skimlinks (XCUST) — deferred.** No SkimLinks approval yet, so we are not adding
the per-creator XCUST column. The design doc's "Skimlinks XCUST (per-creator
param)" row-contract item is on hold until approval comes through. Launch is
Amazon-only on the affiliate side.

**Admin gating — shipped as `creator_profiles.is_admin`, not env-var.** The design
doc's open decision #4 listed env-var allowlist as MVP and `is_admin boolean` as
v1.1 cleanup. To keep RLS aligned with the admin UI from day 1 we shipped
`is_admin` directly (Nicole + Kerri flagged `true`). The
`brand_storefronts_admin_all` and `brand_memberships_admin_all` policies both
check `exists (select 1 from creator_profiles where creator_id = auth.uid() and
is_admin = true)`. **Creators-web `/admin` middleware must read `is_admin` from
the DB** (not an env var) — otherwise admin reads will pass but RLS-protected
writes to `brand_storefronts` and `brand_memberships` will fail for anyone not
also flagged in the DB. There is no env-var fallback path.

**iOS app changes — NOT YET DONE.** The schema is in place but no iOS code reads
brand_memberships or brand_storefronts yet. Until plumbed, Kerri still publishes
everything as herself.

#### iOS storefront-context plumb punch list (next session)
The audit grouped every `creator_id` call site into four buckets. Tackle B first.

(B) WRITE_AS — must respect `activeContext.writeAs` when in storefront mode:
  - `lib/state/lookStore.ts:883` — `publishLook` insert (the core publish path)
  - `lib/amazon/addCampaignProductToCloset.ts:35` — Amazon item creation
  - `lib/awin/addFromCatalog.ts:87` — Awin item creation
  - `lib/utils/fetchProductInfo.ts:119` — product-scrape log (closet import side effect)
  - `components/TryOnModelSheet.tsx:278` — try-on result insert
  All five also need to set `authored_by = user.id` so we keep human credit while
  `creator_id = storefront_creator_id`. The new RLS policy permits these writes when
  the signed-in user has an active 'stylist' membership for the storefront.

(A) PERSONAL — leave alone, always the signed-in human:
  - all `lib/state/profileStore.ts` setters (username/bio/caption_style/etc)
  - `app/payments-payouts.tsx` payout + Amazon tag settings
  - `lib/state/followerSnapshotsStore.ts` (personal social metrics)
  - `lib/state/authStore.ts` signup profile creation

(C) READ_VIEWED_PROFILE — already parameterized, no change:
  - `lib/queries/creatorStats.ts`, `lib/queries/creatorEarnings.ts`,
    `lib/state/profileStore.ts` fetchers, `lib/state/creatorStore.ts`,
    `components/FoundingCreatorMonthRail.tsx`, `components/PayoutSetupBanner.tsx`,
    `components/ItemDetailSheet.tsx`, `components/CompleteProfileSheet.tsx`

(D) UNCLEAR — verify intent before changing:
  - `lib/state/analyticsStore.ts` (Zustand cache — likely PERSONAL)
  - `app/creator-analytics.tsx` (consumer of analyticsStore)
  - `app/(tabs)/shop.tsx` (closet read — should filter by storefront when in brand mode?)
  - `lib/analytics/clickEvents.ts:22` (tracks clicks; verify call sites pass storefront id)
  - `app/_layout.tsx:197` (onboarding gate — should stay personal)

Implementation order for next session:
  1. Add a `contextStore` Zustand slice: `{ activeContext: { writeAs, mode, brandId } }`.
     On signin, prefetch `brand_memberships where creator_id=auth.uid() AND status='active'`
     and the joined `brand_storefronts` into the store. Default mode='personal' (writeAs
     = own creator_id).
  2. UI affordance: top-right avatar menu on Home listing personal + each brand. Switching
     updates activeContext.
  3. Plumb the 5 WRITE_AS sites: replace literal `user.id` / `creatorId` with
     `useContextStore.getState().activeContext.writeAs`; also set
     `authored_by = user.id`.
  4. Add `lib/queries/storefront.ts` for brand-scoped reads (looks/items where
     creator_id=storefront_creator_id) feeding the brand dashboard.
  5. Card byline: show brand name+logo instead of @username when the look's
     `creator_id` resolves to a partner_brand (`feed.tsx`, `(tabs)/index.tsx` LookCard,
     `creator-profile.tsx`). Cheap lookup via the existing profileStore plus the new
     `account_type` field.
  6. payments-payouts.tsx: per-storefront earnings rollups (joined commissions by brand).

**creators-web admin** (gated by `creator_profiles.is_admin = true`):
- Storefronts CRUD page (list, create, edit logo + brand_story + commission_pct, toggle
  is_test).
- Memberships management (add/remove stylist by email lookup, role assignment).
- Brand-scoped earnings dashboard (commissions joined to click_events.creator_id =
  storefront_creator_id, grouped by stylist via authored_by).
The admin section writes to brand_storefronts + brand_memberships via the admin policies
(`*_admin_all`) which check `creator_profiles.is_admin = true`.

---

1. NEVER style `<Pressable>` with StyleSheet (especially `style={({pressed}) => [...]}`) — it
   renders invisibly in this build (see `CLAUDE.md` > mistakes > buttons). Use `<PillButton>` or
   NativeWind `className` STRING LITERALS.
2. Vibecode manages git and resets the tree, wiping SSH-side commits. Do not rely on `git commit`
   over SSH. Leave changes in the working tree; persist via Save in the Vibecode app.
   Forbidden to edit: `babel.config.js`, `metro.config.js`, `app.json`, `tsconfig.json`,
   `nativewind-env.d.ts`, `patches/`.
3. Verify with `bunx tsc --noEmit -p tsconfig.json` — currently 0 errors.

## Not yet done (from the original review)
- ~72 files still hardcode hex colors (incremental theme migration).
- Accessibility labels missing (only ~3/83 screens have any).
- Try-On: `try-on-flow.tsx` is built but the public tab is a "Coming Soon" stub — wire it up.
- Web properties (`workspace-website`, `workspace-webapp`) are essentially empty/placeholder.
- Backend security: rotate committed secrets (Supabase service-role key, Photoroom, ScrapingBee),
  add storage-RLS owner check, add SSRF allowlist on the metadata/redirect routes.
