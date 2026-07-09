# State of the App — 2026-04-27

## Summary

Styled in Motion is in solid beta shape. Core creator flows (signup, add item, create look, share to IG/TikTok) all work end-to-end. The shopper feed, look detail, and save system are functional. The biggest risks are: (1) social features (likes, comments, follows) are local-only and will be lost on device switch, (2) share handler logic is duplicated across two files creating a maintenance trap, and (3) silent error handling in 8+ catch blocks means users get no feedback when operations fail.

Since the 2026-04-21 audit, 8 features shipped: TikTok Share Kit (Phase 1+2), HTML entity decoding, dynamic photo aspect ratios, username uniqueness + availability RPC, ScrapingBee routing for 7 retailers, URL paste normalizer, and delete-account button relocation to a sub-screen.

---

## Critical findings (2)

### C1. Social features are device-local only — likes, comments, follows, saved items

- **Severity:** critical
- **Surface:** All shopper interactions — feed likes, comments, follows, saved items
- **File reference:** `likeStore.ts:5-12` (seeded pseudo-random counts 40-300), `commentStore.ts:22-44` (AsyncStorage only), `followStore.ts:16-33` (AsyncStorage only), `savedItemsStore.ts:19-30` (AsyncStorage only)
- **Description:** All social features persist only to AsyncStorage. A user who switches devices, reinstalls, or clears app data loses all their likes, comments, follows, and saved items. Like counts are seeded with deterministic pseudo-random numbers (40-300) to simulate engagement. None of this syncs to the server.
- **Suggested fix:** Add server-sync for follows and saved items as the minimum viable set; document that likes/comments are local-only in beta
- **Effort estimate:** L (multi-day — requires Supabase tables, RLS, store refactor)

### C2. Silent error handling in 8+ catch blocks — users get no feedback

- **Severity:** critical
- **Surface:** Photo save, share operations, media library, deep links
- **File reference:** `ItemListSheet.tsx:192` (photo save), `ItemListSheet.tsx:213` (share), `create.tsx:370,492,1058` (photo/media ops), `Linking.openURL().catch(() => {})` in 8+ locations
- **Description:** When photo save fails (e.g. permissions denied), share fails (app not installed), or media operations error, the catch block logs to console but shows nothing to the user. The user sees "Saved 0 photos!" with no explanation when permissions are denied.
- **Suggested fix:** Add toast/alert feedback in each catch block; for Linking failures, show "App not installed" message
- **Effort estimate:** M (2-3 prompts — systematic pass through all silent catches)

---

## Important findings (8)

### I1. Share handler duplication between create.tsx and ItemListSheet.tsx

- **Severity:** important
- **Surface:** Look sharing (all channels)
- **File reference:** `create.tsx:769-893` and `ItemListSheet.tsx:102-214`
- **Description:** Five share functions (handleShare, handleShareInstagram, handleShareTikTok, handleSaveAllPhotos, handleShareToStory) are duplicated across two files. Bug fixes or caption changes must be made in both places.
- **Suggested fix:** Extract to `lib/utils/shareActions.ts` and compose via callbacks
- **Effort estimate:** M (2-3 prompts)

### I2. No app-level error boundary

- **Severity:** important
- **Surface:** Entire app
- **File reference:** `_layout.tsx` (no ErrorBoundary component found anywhere in src/)
- **Description:** An unhandled JS error in any component crashes the entire app with no recovery UI. React Native's default red screen shows in dev, but in production the app just closes.
- **Suggested fix:** Add an ErrorBoundary wrapper in `_layout.tsx` with a "Something went wrong" screen and restart button
- **Effort estimate:** S (1 prompt)

### I3. Backend /api/accounts stores passwords in plaintext (unused but dangerous)

- **Severity:** important
- **Surface:** Backend scaffold route
- **File reference:** `backend/src/routes/accounts.ts:40,85`
- **Description:** The accounts route stores passwords as raw text in SQLite: `INSERT INTO ... (name, email, password) VALUES (?, ?, ?)`. Login compares with `===`. However, the mobile app does NOT use this route — auth goes through Supabase directly. The route is dead code but still mountable.
- **Suggested fix:** Delete the entire `/api/accounts` route and its SQLite DB, or add bcrypt hashing if planning to use it
- **Effort estimate:** S (1 prompt to delete)

### I4. `rowToLook()` and `CATEGORY_EMOJI` duplicated in two files

- **Severity:** important
- **Surface:** Deep-link look detail, look store
- **File reference:** `look/[id].tsx:28-97` and `lookStore.ts`
- **Description:** The full DB-row-to-Look mapper and category emoji map are duplicated. Changes to the look data shape require updates in both places.
- **Suggested fix:** Extract to `lib/mappers.ts` and `lib/constants.ts`
- **Effort estimate:** S (1 prompt)

### I5. Delete-account timeout race condition

- **Severity:** important
- **Surface:** Account Settings > Delete Account
- **File reference:** `authStore.ts:198-224`, `account-settings.tsx:101-110`
- **Description:** The delete-account edge function has a 30s timeout. If it times out, the local auth state is cleared (user appears logged out) but the server account may still exist. No reconciliation mechanism exists.
- **Suggested fix:** On timeout, show specific error explaining the account may not be fully deleted and to contact support
- **Effort estimate:** S (1 prompt)

### I6. Draft persistence can resurrect deleted looks

- **Severity:** important
- **Surface:** Create/Edit look flow
- **File reference:** `draftLookStore` + `create.tsx:204-217`
- **Description:** If a creator deletes a look but has draft state persisted in AsyncStorage from an earlier edit session, reopening Create may attempt to pre-populate from the deleted look's data.
- **Suggested fix:** Clear draft state when a look is deleted in `lookStore.deleteLook()`
- **Effort estimate:** S (1 prompt)

### I7. Click counter is client-side only — can drift from server

- **Severity:** important
- **Surface:** Look/item analytics
- **File reference:** `lookStore.ts:720-730`
- **Description:** `incrementClicks()` updates the local count and does a fire-and-forget Supabase update. If the network request fails, the local count increments but the server count doesn't, causing permanent drift.
- **Suggested fix:** Add retry queue or reconcile counts on next app open
- **Effort estimate:** M (2-3 prompts)

### I8. 10+ `as any` type assertions throughout codebase

- **Severity:** important
- **Surface:** Route navigation, error handling, Supabase queries
- **File reference:** Multiple — `router.replace('/(tabs)' as any)`, `(error as any).code`, `(data as any)[col]`
- **Description:** Type safety holes that could mask bugs. Route `as any` casts bypass Expo Router's typed routes.
- **Suggested fix:** Use proper typed route helpers and discriminated union error types
- **Effort estimate:** M (2-3 prompts)

---

## Nice-to-have findings (10)

### N1. No skeleton/shimmer loading states

- **Severity:** nice-to-have
- **Surface:** All screens with data loading (feed, shop, profile)
- **File reference:** All screens use `ActivityIndicator` — no skeleton components exist
- **Description:** Every loading state shows a plain spinner. Skeleton screens would feel more polished and reduce perceived load time.
- **Suggested fix:** Add skeleton component for look cards and item grids
- **Effort estimate:** M (2-3 prompts)

### N2. No pull-to-refresh on creator shop screen

- **Severity:** nice-to-have
- **Surface:** Creator shop (My Shop tab)
- **File reference:** `shop.tsx` — FlatList without RefreshControl (shopper feed has it at `feed.tsx:534-536`)
- **Description:** Creator's shop screen has no pull-to-refresh. Data refreshes only on focus/mount.
- **Suggested fix:** Add RefreshControl to the shop FlatList
- **Effort estimate:** S (1 prompt)

### N3. No toast/feedback on profile settings save

- **Severity:** nice-to-have
- **Surface:** Creator profile — toggle changes, text field saves
- **File reference:** `(tabs)/profile.tsx` — multiple save handlers with no success feedback
- **Description:** When a creator toggles a setting or saves their bio, there's no confirmation that the change was saved.
- **Suggested fix:** Add a brief toast or checkmark animation on successful save
- **Effort estimate:** S (1 prompt)

### N4. Price input doesn't validate number format

- **Severity:** nice-to-have
- **Surface:** Add Item flow
- **File reference:** `add-closet-item.tsx:51`
- **Description:** Price field strips `$` prefix but allows non-numeric input like "abc". Won't crash, but could look odd in the shop.
- **Suggested fix:** Add numeric keyboard type and validation
- **Effort estimate:** S (1 prompt)

### N5. No duplicate URL detection when adding closet items

- **Severity:** nice-to-have
- **Surface:** Add Item flow
- **File reference:** `add-closet-item.tsx:97-128`
- **Description:** A creator can add the same product URL to their closet multiple times. No check against existing items.
- **Suggested fix:** Check closet items for matching URL before save, warn if duplicate
- **Effort estimate:** S (1 prompt)

### N6. Follower count shows empty string instead of "0" when count is 0

- **Severity:** nice-to-have
- **Surface:** Creator profile
- **File reference:** `(tabs)/profile.tsx:532`
- **Description:** If `followerCount` is 0, the display shows an empty string rather than "0".
- **Suggested fix:** Use `String(followerCount)` instead of truthy check
- **Effort estimate:** S (1 prompt)

### N7. Deep-link look fetch shows generic "not available" for network errors

- **Severity:** nice-to-have
- **Surface:** Look detail via deep link
- **File reference:** `look/[id].tsx:147-172`
- **Description:** When a look is fetched via deep link and the network fails, the user sees "Look not available" — same message as a genuinely missing look. No retry option.
- **Suggested fix:** Distinguish "not found" from "network error" and add retry button
- **Effort estimate:** S (1 prompt)

### N8. Auto-tag edge function has no retry mechanism

- **Severity:** nice-to-have
- **Surface:** Look creation
- **File reference:** `lookStore.ts` — auto-tag invocation
- **Description:** If the `auto-tag-look` Supabase edge function fails (timeout, OpenAI error), tags are never generated for that look. No queue or retry.
- **Suggested fix:** Add exponential backoff retry (3 attempts) on failure
- **Effort estimate:** S (1 prompt)

### N9. EXPO_PUBLIC_EXAMPLE_ENV_VAR is unused

- **Severity:** nice-to-have
- **Surface:** Environment configuration
- **File reference:** `mobile/.env`, `mobile/.env.production`
- **Description:** Placeholder env var from initial scaffold. No code references it.
- **Suggested fix:** Remove from both .env files
- **Effort estimate:** S (1 prompt)

### N10. Console.log statements in production code (76 instances)

- **Severity:** nice-to-have
- **Surface:** Throughout mobile app
- **File reference:** 24 files, heaviest in `fetchProductInfo.ts` (20), `lookStore.ts` (54)
- **Description:** Extensive debug logging left in. Not harmful but increases noise in production logs and leaks internal state.
- **Suggested fix:** Replace with a debug-only logger or remove non-error logs
- **Effort estimate:** M (2-3 prompts)

---

## Pending tasks (from previous audit + git history)

### From known technical debt (previous audit)

| Task | Priority | Status |
|------|----------|--------|
| Extract share handlers to shared utility | High | Not started |
| Fix silent catch blocks (8 instances) | High | Not started |
| Extract `rowToLook()` and `CATEGORY_EMOJI` to shared files | Medium | Not started |
| Replace `as any` assertions with proper types | Medium | Not started |
| Add `catch (e: unknown)` with type narrowing (6 instances) | Medium | Not started |
| Server-sync for follows/comments/likes | Low (beta ok) | Not started |
| Document that like counts are seeded in beta | Low | Not started |
| Add retry to auto-tag edge function | Low | Not started |

### From recent feature work

| Task | Priority | Status |
|------|----------|--------|
| TikTok Share Kit — move from sandbox to production key | High | Blocked (needs TikTok review) |
| Waitlist capture from styledinmotion.app | Unknown | Not in codebase — may be on marketing site |
| OPENAI_API_KEY in backend .env but unused by backend code | Low | Cleanup needed |

---

## What's solid (don't break)

These surfaces are stable, well-tested, and working correctly:

1. **Supabase Auth flow** — signup, login, session refresh, email confirmation, token expiry handling, cross-reinstall recovery. Rock solid. (`authStore.ts`)

2. **Add Item + metadata fetch pipeline** — 4-tier fallback (direct, ScrapingBee, Microlink, Jsonlink) with telemetry logging. URL normalizer handles messy pastes. ScrapingBee routing correctly targets 7 blocked retailers. (`fetchProductInfo.ts`, `scrapingbee-routing.ts`, `normalizeUrlInput.ts`)

3. **Username availability checker** — Debounced RPC with race condition protection, suggestions on taken, proper validation (3-30 chars, no leading/trailing dots). (`UsernameField.tsx`)

4. **Look creation + editing** — Full 5-step flow (photo, items, layout, caption, share) with edit mode. All steps work, state management clean. (`create.tsx`)

5. **HTML entity decoding** — Multi-pass decoder handles chained entities. Applied everywhere external text appears. Both mobile and backend have identical implementations. (`decode-entities.ts`)

6. **Dynamic photo aspect ratios** — Calculates from actual image dimensions on load, with 2/3 fallback. Applied in shop, home, and detail sheets. (`shop.tsx`, look detail)

7. **Delete account flow** — Now behind a sub-screen ("Account Settings") with hardened confirmation dialog: destructive title, specific consequence text, Cancel as visual default. Edge function cascade handles storage + DB cleanup. (`account-settings.tsx`, `authStore.ts:187-224`)

8. **ItemDetailSheet** — Confirmation dialogs for every destructive action (remove from look, delete from closet, delete forever, empty-look cascade). Error handling with toast feedback. Gesture-dismissible. (`ItemDetailSheet.tsx`)

9. **Share flows (all 3 channels)** — Generic share, Instagram (Stories + Feed with album save), TikTok Share Kit (Phase 1+2 with post-share nudge). All have error handling and clipboard fallbacks. (`shareLook.ts`, `shareToTikTok.ts`, `TikTokPostShareNudge.tsx`)

10. **Shopper feed** — Pull-to-refresh, smart "following" tab switch, empty states per tab, vertical look cards with creator badges and action buttons. (`feed.tsx`)

---

## Recommended next 3 things to ship

### 1. Fix silent error handling (8+ catch blocks) — Effort: M

**Impact:** Users currently get zero feedback when photos fail to save, shares fail, or apps aren't installed. This is the single most impactful UX improvement available.

**Scope:** Systematic pass through `ItemListSheet.tsx:192,213`, `create.tsx:370,492,1058`, and all `Linking.openURL().catch(() => {})` calls. Add toast messages for each failure mode.

### 2. Extract share handlers to shared utility — Effort: M

**Impact:** Eliminates the maintenance trap where caption changes or bug fixes must be made in two files. Prevents future share-related bugs from being fixed in one place but not the other.

**Scope:** Move 5 share functions from `create.tsx` and `ItemListSheet.tsx` into `lib/utils/shareActions.ts`. Wire both call sites to use the shared functions.

### 3. Add error boundary to app layout — Effort: S

**Impact:** Prevents full app crashes from showing a blank screen in production. Gives users a way to recover without force-quitting. Low effort, high safety net.

**Scope:** Create `ErrorBoundary` component, wrap `RootLayoutNav` in `_layout.tsx`. Show "Something went wrong" screen with restart button.
