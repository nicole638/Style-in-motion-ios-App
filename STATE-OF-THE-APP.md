# Styled in Motion — State of the App

**Generated:** 2026-04-21
**Mobile commit:** c048138
**Supabase project:** rghlcnrttvlvphzahudf
**Latest migration:** 20260421_create_metadata_fetch_logs.sql

---

## 1. Database Schema

### Tables

#### looks
Purpose: Core content — each row is a styled outfit post published by a creator.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| creator_id | uuid FK → creators.id | |
| title | text | |
| cover_photo_url | text | URL in `look-photos` storage bucket |
| layout | text | `clean-grid` / `minimal-luxury` / `cozy-neutral` / `bold-influencer` |
| caption | text | |
| hashtags | text[] | |
| category | text | |
| tags | text[] | |
| clicks | int | Incremented client-side on item link taps |
| archived | boolean | Soft-delete for creator archive |
| created_at | timestamptz | |
| occasion | text[] | AI-generated |
| season | text[] | AI-generated |
| style_vibe | text[] | AI-generated |
| color_palette | text[] | AI-generated |
| clothing_type | text[] | AI-generated |
| ai_tags_generated | boolean | |
| ai_tags_raw | jsonb | Raw OpenAI response |
| creator_tags | text[] | Normalized from hashtags |

**Indexes:** GIN on occasion, season, style_vibe, color_palette, clothing_type, creator_tags.

#### creators
Purpose: Creator account identity row linked to Supabase auth.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Matches auth.users.id |
| email | text | |
| name | text | |

#### creator_profiles
Purpose: Creator's public profile, preferences, and social handles.

| Column | Type | Notes |
|--------|------|-------|
| creator_id | uuid PK, FK → creators.id | |
| username | text | |
| bio | text | |
| location | text | Nullable, city-level |
| photo_url | text | URL in `profile-photos` bucket |
| caption_style | text | `Casual` / `Professional` / `Minimal` |
| include_hashtags | boolean | |
| include_prices | boolean | |
| follower_count | int | |
| instagram_handle | text | |
| instagram_enabled | boolean | |
| tiktok_handle | text | |
| tiktok_enabled | boolean | |
| youtube_handle | text | |
| youtube_enabled | boolean | |
| pinterest_handle | text | |
| pinterest_enabled | boolean | |
| subscription_status | text NOT NULL | `free` / `trialing` / `active` / `past_due` / `canceled` (default `free`) |
| stripe_customer_id | text | Nullable, unique; set by Stripe webhook after first Checkout |
| is_beta_creator | boolean NOT NULL | Default `false`; `true` = lifetime access regardless of subscription |

#### creator_items
Purpose: Canonical closet — each unique product URL a creator has ever linked.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| creator_id | uuid FK → creators.id | |
| category | text | Top/Pants/Dress/Shoes/Bag/Jewelry/Accessory/Outerwear/Other |
| name | text | |
| price | text | |
| url | text | Canonical product URL |
| photo_url | text | |
| brand | text | |
| primary_note | text | Creator's note |
| archived | boolean | |
| created_at | timestamptz | |
| alternate_link | text | Alternative product URL |
| alternate_label | text | |
| alternate_name | text | |
| alternate_price | text | |
| alternate_brand | text | |
| alternate_photo_url | text | |
| alternate_category | text | |

**Unique constraint:** `(creator_id, LOWER(TRIM(url)))` — canonical deduplication.

#### look_items
Purpose: Join table linking looks to closet items with sort order.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| look_id | uuid FK → looks.id | |
| creator_item_id | uuid FK → creator_items.id | |
| sort_order | int | |

**Unique constraint:** `(look_id, creator_item_id)`.

#### audience_accounts
Purpose: Shopper/consumer user identity.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Matches auth.users.id |
| email | text | |
| name | text | |
| profile_photo_url | text | Added 2026-04-19 |
| location | text | Added 2026-04-19 |

#### categories
Purpose: Look categories for filtering (creator-assigned, shopper-browsed).

| Column | Type | Notes |
|--------|------|-------|
| id | text PK | |
| name | text | |
| slug | text | |
| icon | text | Emoji or icon name |
| sort_order | int | |

#### look_views
Purpose: Analytics — tracks where a look was viewed from.

| Column | Type | Notes |
|--------|------|-------|
| look_id | uuid FK → looks.id | |
| creator_id | uuid FK → creators.id | |
| source | text | `following` / `discover` / `profile` / `search` |
| created_at | timestamptz | Auto |

#### item_clicks
Purpose: Analytics — tracks which items shoppers click.

| Column | Type | Notes |
|--------|------|-------|
| look_id | uuid FK → looks.id | |
| creator_id | uuid FK → creators.id | |
| item_name | text | |
| item_index | int | Position in look |
| created_at | timestamptz | Auto |

#### follower_snapshots
Purpose: Daily snapshots of creator social follower counts for growth charts.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| creator_id | uuid FK → creators.id | |
| platform | text | `instagram` / `tiktok` / `youtube` / `pinterest` |
| follower_count | int | |
| snapshot_date | text | ISO `YYYY-MM-DD` |

#### metadata_fetch_logs
Purpose: Telemetry for the 4-tier product metadata scraping pipeline.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| created_at | timestamptz | |
| url | text | Product URL attempted |
| domain | text | Extracted domain |
| source | text | `direct` / `backend` / `microlink` / `jsonlink` |
| source_order | smallint | 1-4 cascade position |
| http_status | int | Nullable |
| latency_ms | int | |
| ok | boolean | |
| fields_count | smallint | How many metadata fields resolved |
| field_flags | jsonb | Which fields succeeded |
| parser_path | text | |
| is_final | boolean | Was this the source that "won"? |
| error_message | text | |
| creator_id | uuid | |

**RLS:** INSERT for authenticated; SELECT for service_role only.
**Indexes:** `(domain, created_at DESC)`, `(source, created_at DESC)`.

### Storage Buckets

| Bucket | Purpose |
|--------|---------|
| look-photos | Look cover photos |
| item-photos | Product item photos + alternates |
| profile-photos | Creator profile avatars |

### Relationships (ER sketch)

```
auth.users
  ├── (1:1) creators
  │     ├── (1:1) creator_profiles
  │     ├── (1:N) creator_items ──┐
  │     ├── (1:N) looks           │  (M:N via look_items)
  │     │     ├── (1:N) look_items ←┘
  │     │     ├── (1:N) look_views
  │     │     └── (1:N) item_clicks
  │     ├── (1:N) follower_snapshots
  │     └── (1:N) metadata_fetch_logs
  │
  └── (1:1) audience_accounts
```

Cascading deletes: deleting a creator cascades to looks → look_items, creator_items, creator_profiles, follower_snapshots.

---

## 2. Edge Functions

### auto-tag-look
- **Entry:** `supabase/functions/auto-tag-look/index.ts`
- **Purpose:** AI-powered look tagging via OpenAI Vision (`gpt-4o-mini`). Fetches look + items, sends cover photo + metadata to OpenAI, writes structured tags (occasion, season, style_vibe, color_palette, clothing_type, creator_tags) back to the `looks` row.
- **Invoked from:** `mobile/src/lib/state/lookStore.ts:487` (after create) and `:611` (after edit with new items). Fire-and-forget — errors logged, not surfaced.
- **External deps:** OpenAI API (`openai_api_key` env var)
- **Known gotchas:** If OpenAI is slow or rate-limited, tags arrive minutes after publish. No retry mechanism. If the look is deleted before tagging completes, the update silently fails (look row gone).

### delete-account
- **Entry:** `supabase/functions/delete-account/index.ts`
- **Purpose:** Hard-deletes a user's auth record + all related data via FK cascades.
- **Invoked from:** `mobile/src/lib/state/authStore.ts:214`. Awaited with 30-second timeout.
- **External deps:** None (Supabase admin client only).
- **Known gotchas:** If the edge function times out, the user sees a generic error but auth state is cleared locally. The account may still exist server-side. No reconciliation mechanism.

---

## 3. Creator Flows

### Create a Look

| Step | Screen | What happens | State changes |
|------|--------|-------------|---------------|
| 0 | `create.tsx:1039` StepUploadPhoto | Image picker → crop/resize → set photoUri | `draftLookStore.setPhotoUri()` |
| 1 | `create.tsx:1070` StepAddItems | URL paste → `fetchProductInfo()` 4-tier scrape → fill name/price/brand/image → add to items array | `draftLookStore.setItems()`, telemetry → `metadata_fetch_logs` |
| 2 | `create.tsx:1148` StepChooseLayout | Select layout grid style | `draftLookStore.setSelectedLayout()` |
| 3 | `create.tsx:1155` StepPreview | Caption, hashtags, title, category, tags → tap "Post" | `draftLookStore.*` setters |
| Publish | `create.tsx:678` handleSaveLook | Filters blank items → `lookStore.addLook()` | See below |
| 4 | `create.tsx:1181` Success overlay | ShareActionsBlock (Pattern A pills) + Done buttons | `posted=true`, `clearDraft()` |

**`addLook()` path** (`lookStore.ts:428-567`):
1. `:456` Upload cover photo → `look-photos` bucket
2. `:466` INSERT `looks` row
3. `:487` Fire-and-forget `auto-tag-look` edge function
4. `:495-533` For each item: `upsertCreatorItem()` (dedup by canonical URL) → INSERT `look_items` join
5. `:537` Re-fetch look with embedded items
6. `:561` Prepend to `store.looks`

### Edit a Look

**Trigger:** `shop.tsx` → Edit Look ActionRow → sets `editingLookId` → navigates to `/(tabs)/create`.

**Draft load** (`create.tsx:184-229`):
- `:204` Finds look in `lookStore.looks` or fetches via `fetchLooksByCreator()`
- `:187-201` `populateFromLook()` pre-fills all draft fields, sets `isEditMode=true`

**Save** (`create.tsx:691-711`): calls `lookStore.updateLook()` which:
- `:598` UPDATE `looks` metadata
- `:609` Re-invoke `auto-tag-look` if new items added
- `:643-680` Diff `look_items` joins: delete removed, insert added, update sort_order

### Share Surfaces

ShareActionsBlock renders on **3 surfaces**:

| Surface | File:Line | Variant | Context |
|---------|-----------|---------|---------|
| Post-publish success | `create.tsx:1208` | `pills` (default) | Step 4 success overlay |
| StepExport | `create.tsx:2646` | `pills` (default) | Export step |
| Shop detail bottom sheet | `ItemListSheet.tsx:288` | `list` | Creator-only; below look photo |

**Share handlers** (defined in `create.tsx:769-893` and duplicated in `ItemListSheet.tsx:102-214`):

| Handler | Action |
|---------|--------|
| `handleShare` / `handleShareLook` | Builds URL + message via `shareLook.ts`, opens native Share sheet |
| `handleSaveAllPhotos` | Saves cover + all item photos to device album "Styled in Motion" |
| `handleShareToStory` | Copies look URL → clipboard, saves cover photo, shows success banner |
| `handleShareInstagram` | Copies caption → clipboard, saves photos, opens Instagram app |
| `handleShareTikTok` | Saves cover photo, copies item list + caption, opens TikTok |

**Utility:** `src/lib/utils/shareLook.ts` — `buildLookShareUrl()`, `buildShareText()`, `savePhotosToAlbum()`.

### Delete a Look

**Trigger:** `shop.tsx` → Delete Look ActionRow (within ItemListSheet or shop detail)

**Path:** `lookStore.deleteLook()` (`lookStore.ts:712-719`):
1. Optimistic: remove from `store.looks`
2. `supabase.from('looks').delete().eq('id', id)` — FK cascades handle `look_items`

### Delete Account

**Trigger:** `profile.tsx:829` → confirmation modal → `authStore.deleteAccount()`

**Path** (`authStore.ts:199-237`):
1. `:206` Get session + access token
2. `:213` Invoke `delete-account` edge function (30s timeout)
3. Edge function: admin `deleteUser()` → FK cascades wipe all data
4. `:230` Local sign out (`scope: 'local'`)
5. `:234` Route to `/welcome`

### Add Item to Closet

**Entry:** `create.tsx:426` `handleLinkSubmit()` — user pastes product URL.

**4-tier metadata cascade** (`src/lib/utils/fetchProductInfo.ts:359-415`):

| Tier | Source | Timeout | Method |
|------|--------|---------|--------|
| 1 | Direct fetch | 8s | HTML parse: JSON-LD, OG tags, Twitter cards |
| 2 | Backend (ScrapingBee) | 20s | `/api/product-info?url=...` |
| 3 | Microlink | 10s | `api.microlink.io` |
| 4 | Jsonlink | 10s | `jsonlink.io` |

Stops on first result with name+image OR price. Each attempt logged to `metadata_fetch_logs`.

**Dedup on publish** (`lookStore.ts:245-317` `upsertCreatorItem()`):
- Query by `LOWER(TRIM(url))` → update existing or insert new
- 23505 race condition handled with re-query

---

## 4. Shopper Flows

### Sign Up

**Screen:** `public-signup.tsx` — dual-tab login/signup form.

**Path:**
1. Form validation: name, email, 6+ char password
2. `authStore.signupAsPublic()` (`authStore.ts:72-107`)
3. `supabase.auth.signUp()` with `user_metadata: { user_type: 'audience', name }`
4. INSERT `audience_accounts` row
5. Set state: `isLoggedIn: true, userType: 'audience'`
6. Redirect → `/(public-tabs)/feed`

Returns typed results: `success`, `email_taken`, `confirm_email`, `error`.

### Discover & Save

**Feed** (`(public-tabs)/feed.tsx`):
- On mount: `lookStore.fetchLooks()` → SELECT all non-archived looks
- Fetches creator profiles for usernames/avatars
- Two filters: `all` | `following` (auto-switches on first follow)
- LookCard tap → `ItemListSheet` modal + analytics `trackView()`

**Search** (`(public-tabs)/search.tsx`):
- Text search: AND across words, matches title/caption/hashtags/AI tags/item names/brands
- Filter dropdowns: category (single), brand (single), occasion/style/season (multi, OR within dimension)
- Card tap → ItemListSheet

**Saved** (`(public-tabs)/saved.tsx`):
- Derived from `lookStore.looks` filtered by `likeStore.likedLookIds`
- Toggle between looks grid and items list views
- Item tap → `Linking.openURL(item.link)`

### Shop a Look

**From feed/search:** Tap → `ItemListSheet` modal.
**From deep link:** `/look/[id]` route → cache-first lookup, Supabase fallback.

**Item click flow** (`ItemListSheet.tsx:90-100`):
1. Haptic feedback
2. `lookStore.incrementClicks(look.id)` — bumps click counter
3. `analyticsStore.trackItemClick()` → INSERT `item_clicks`
4. `Linking.openURL(item.link)` — opens retailer in browser

### Delete Account (Shopper)

Same flow as creator: `profile.tsx` → confirmation → `authStore.deleteAccount()` → edge function → FK cascade deletes `audience_accounts` row.

---

## 5. State Stores

### authStore
- **File:** `src/lib/state/authStore.ts`
- **Shape:** `userType`, `isLoggedIn`, `creatorId`, `creatorName`, `publicUser`, `_hasHydrated`
- **Persistence:** None (session from Supabase auth)
- **Writers:** `initialize()`, `signupAsPublic()`, `signupAsCreator()`, `login()`, `loginAsPublic()`, `logout()`, `deleteAccount()`
- **Readers:** Root layout, index.tsx redirect, all profile screens, all tab layouts

### profileStore
- **File:** `src/lib/state/profileStore.ts`
- **Shape:** `profiles` (Record<id, CreatorProfile>), `activeCreatorId`, field-level accessors (username, bio, location, photoUri, captionStyle, etc.)
- **Persistence:** None (server state)
- **Writers:** `switchCreator()`, `fetchProfile()`, `fetchProfilesForCreators()`, `setUsername()`, `setBio()`, `setLocation()`, `setPhotoUri()`, `setCaptionStyle()`, `setIncludeHashtags()`, `setIncludePrices()`, `setSocialFollowerCount()`
- **Readers:** Creator profile screens, feed (for creator names/avatars), creator-profile.tsx

### creatorStore
- **File:** `src/lib/state/creatorStore.ts`
- **Shape:** `handlesPerCreator`, `activeCreatorId`, `handles` (PlatformHandle[]), `primaryPlatform`
- **Persistence:** AsyncStorage `creator-storage-v3` (all fields)
- **Writers:** `switchCreator()`, `fetchFromSupabase()`, `updateHandle()`, `toggleConnected()`, `setFollowers()`, `setPrimaryPlatform()`, `saveSocialsToSupabase()`
- **Readers:** Profile tab, onboarding-socials, analytics

### lookStore
- **File:** `src/lib/state/lookStore.ts`
- **Shape:** `looks` (Look[]), `archivedLooksByCreator`, `closetItems`, `archivedClosetItems`, `_hasHydrated`
- **Persistence:** None (server state)
- **Writers:** `fetchLooks()`, `fetchLooksByCreator()`, `fetchArchivedLooksByCreator()`, `loadClosetItems()`, `loadArchivedClosetItems()`, `addLook()`, `updateLook()`, `deleteLook()`, `archiveLook()`, `unarchiveLook()`, `updateItem()`, `archiveItem()`, `unarchiveItem()`, `removeItemFromLook()`, `deleteItemFromCloset()`, `incrementClicks()`
- **Readers:** All tab screens, ItemListSheet, look/[id], creator-profile, feed, search, saved

### draftLookStore
- **File:** `src/lib/state/draftLookStore.ts`
- **Shape:** `currentStep`, `photoUri`, `items`, `selectedLayout`, `caption`, `selectedHashtags`, `lookTitle`, `lookCategory`, `lookTags`, `editingLookId`
- **Persistence:** AsyncStorage `draft-look-storage` (all except currentStep)
- **Writers:** All step setters, `clearDraft()`, `setEditingLookId()`
- **Readers:** create.tsx exclusively

### likeStore
- **File:** `src/lib/state/likeStore.ts`
- **Shape:** `likedLookIds` (string[]), `likeCounts` (Record<string, number>)
- **Persistence:** AsyncStorage `like-storage`
- **Writers:** `toggleLike()`
- **Readers:** Feed, saved, creator-profile
- **Note:** Uses deterministic seed counts (40-300 range) for looks without explicit like counts.

### savedItemsStore
- **File:** `src/lib/state/savedItemsStore.ts`
- **Shape:** `savedItems` (SavedItem[])
- **Persistence:** AsyncStorage `saved-items-storage`
- **Writers:** `toggleSaveItem()`, `removeSavedItem()`
- **Readers:** Saved tab (items view)

### followStore
- **File:** `src/lib/state/followStore.ts`
- **Shape:** `followMap` (Record<userId, creatorId[]>)
- **Persistence:** AsyncStorage `follow-storage`
- **Writers:** `toggleFollow()`
- **Readers:** Feed (following filter), creator-profile (follow button/count)

### commentStore
- **File:** `src/lib/state/commentStore.ts`
- **Shape:** `comments` (Record<lookId, Comment[]>)
- **Persistence:** AsyncStorage `comment-storage`
- **Writers:** `addComment()`, `deleteComment()`
- **Readers:** ItemListSheet (comment section)

### hashtagStore
- **File:** `src/lib/state/hashtagStore.ts`
- **Shape:** `savedHashtags` (string[])
- **Persistence:** AsyncStorage `hashtag-storage`
- **Writers:** `addHashtag()`, `removeHashtag()`, `reorderHashtags()`
- **Readers:** Create step 3 (hashtag picker)
- **Note:** Ships with 20 default hashtags.

### brandStore
- **File:** `src/lib/state/brandStore.ts`
- **Shape:** `brands` (string[]), `customBrands` (string[])
- **Persistence:** AsyncStorage `brand-storage` (customBrands only)
- **Writers:** `addCustomBrand()`, `removeCustomBrand()`
- **Readers:** Create step 1 (brand auto-fill), search filter
- **Note:** Ships with 37 built-in brands.

### categoryStore
- **File:** `src/lib/state/categoryStore.ts`
- **Shape:** `categories` (Category[]), `isLoading`
- **Persistence:** None (server state, cached after first fetch)
- **Writers:** `fetchCategories()`
- **Readers:** Create step 3, search filter

### analyticsStore
- **File:** `src/lib/state/analyticsStore.ts`
- **Shape:** `lookViews` (LookViewEvent[]), `itemClicks` (ItemClickEvent[])
- **Persistence:** AsyncStorage `analytics-storage`
- **Writers:** `trackView()`, `trackItemClick()`
- **Readers:** Analytics tab, creator-stats
- **Note:** Fire-and-forget Supabase inserts for `look_views` and `item_clicks`.

### followerSnapshotsStore
- **File:** `src/lib/state/followerSnapshotsStore.ts`
- **Shape:** `snapshots` (FollowerSnapshot[]), `loading`, `error`
- **Persistence:** None (server state)
- **Writers:** `fetchSnapshots()`, `takeSnapshotIfNeeded()`
- **Readers:** Analytics tab (growth charts)
- **Note:** Calls backend `/api/social-followers` for live counts.

---

## 6. Routes

### Root Stack (src/app/_layout.tsx)

| Route | File | Renders | Auth guard |
|-------|------|---------|-----------|
| `/` | `index.tsx` | Redirect: creators → `/(tabs)`, audience → `/(public-tabs)/feed`, unauth → `/welcome` | Yes |
| `/(tabs)` | `(tabs)/_layout.tsx` | Creator tab navigator (5 tabs) | Creator only |
| `/(public-tabs)` | `(public-tabs)/_layout.tsx` | Audience tab navigator (3 tabs) | Audience only |
| `/welcome` | `welcome.tsx` | Auth landing page | None |
| `/creator-login` | `creator-login.tsx` | Creator email/password login | None |
| `/public-signup` | `public-signup.tsx` | Audience login/signup (dual tab) | None |
| `/onboarding-socials` | `onboarding-socials.tsx` | Social handles collection | Post-signup |
| `/creator-profile` | `creator-profile.tsx` | Public creator profile view | Any logged-in |
| `/creator-stats` | `creator-stats.tsx` | Creator analytics dashboard | Any logged-in |
| `/reset-password` | `reset-password.tsx` | Password reset from email link | Via deep link |
| `/look/[id]` | `look/[id].tsx` | Single look detail page | Any logged-in |
| `/profile` | `profile.tsx` | User profile settings | Any logged-in |
| `/terms-of-service` | `terms-of-service.tsx` | Legal document | None |
| `/privacy-policy` | `privacy-policy.tsx` | Legal document | None |
| `/modal` | `modal.tsx` | Example modal (presentation: modal) | None |

### Creator Tabs

| Tab | Icon | File | Purpose |
|-----|------|------|---------|
| Home | house | `(tabs)/index.tsx` | Creator's own looks gallery |
| Create | plus.circle | `(tabs)/create.tsx` | 5-step look creation |
| Shop | bag | `(tabs)/shop.tsx` | Look commerce + item detail |
| Profile | person | `(tabs)/profile.tsx` | Creator settings + social handles |
| Stats | chart.bar | `(tabs)/analytics.tsx` | Views, clicks, likes, follows charts |

### Audience Tabs

| Tab | Icon | File | Purpose |
|-----|------|------|---------|
| Feed | compass | `(public-tabs)/feed.tsx` | Discover looks from followed + all creators |
| Discover | magnifyingglass | `(public-tabs)/search.tsx` | Search + filter looks by category/brand/tags |
| Saved | heart | `(public-tabs)/saved.tsx` | Liked looks + saved items |

### Deep Links

- **Scheme:** `styledinmotion://`
- **Email verification:** `styledinmotion://auth/confirm#access_token=X&refresh_token=Y` → `/reset-password`
- **iOS Universal Links:** `applinks:app.styledinmotion.app`
- **Social app queries:** Instagram, Instagram Stories, TikTok (LSApplicationQueriesSchemes)

---

## 7. Known Technical Debt

### High

- **Share handler duplication:** Share logic is duplicated between `create.tsx:769-893` and `ItemListSheet.tsx:102-214`. Should be extracted to shared utility or composed via ShareActionsBlock callbacks from a single source.

### Medium

- **`as any` type assertions (10+ instances):** Route paths (`router.replace('/(tabs)' as any)`), error codes (`(error as any).code`), Supabase dynamic column access (`(data as any)[col]`). Should use proper typed routes and discriminated union error types.
- **Silent catch blocks (8 instances):** `ItemListSheet.tsx:192`, `:213`; `create.tsx:370`, `:492`, `:1058`; both tab layouts. Photo save and media operations fail without user feedback. Should show toast/alert for user-facing ops.
- **Untyped error params (`catch (e: any)`):** 6 instances across `followerSnapshotsStore`, `profile.tsx`, `create.tsx`, `fetchProductInfo.ts`. Should use `catch (e: unknown)` with type narrowing.
- **`CATEGORY_EMOJI` duplicated:** Defined in both `look/[id].tsx:28-30` and `lookStore.ts`. Comment explains why (independent fetch path), but should be in `lib/constants.ts`.
- **`rowToLook()` duplicated:** Full DB-row-to-Look mapper duplicated in `look/[id].tsx:34-97` (for deep-link fallback fetch) and `lookStore.ts`. Same extraction recommendation.

### Low

- **Like counts are seeded, not real:** `likeStore` generates deterministic pseudo-random counts (40-300) when a look has no explicit count. Shoppers see fabricated numbers. This is by design for beta but should be documented or removed before public launch.
- **Follows/comments/likes are local-only:** `followStore`, `commentStore`, `likeStore`, `savedItemsStore` persist to AsyncStorage only — no server sync. A user's follows/likes are lost on device switch or app reinstall.
- **Auto-tag has no retry:** If `auto-tag-look` edge function fails, tags are never generated. No queue, no retry, no admin notification.
- **Delete-account timeout race:** If the edge function times out at 30s, the local auth state is cleared but the server account may still exist. No reconciliation.
- **`Linking.openURL().catch(() => {})` (8+ instances):** Silently swallows "app not installed" errors across all share handlers. Acceptable pattern but no user feedback when social apps aren't installed.

---

## 8. Open Bugs Without an Active Prompt

1. **Photo save failures silent on iOS** — `ItemListSheet.tsx:192` catches and ignores `savePhotosToAlbum()` errors. If media library permissions are denied, user sees "Saved 0 photos!" with no explanation. Medium severity. `ItemListSheet.tsx:192`.

2. **Click counter is client-side only** — `lookStore.incrementClicks()` updates the local count and does a fire-and-forget Supabase update. If the update fails (network, RLS), the count drifts. Low severity. `lookStore.ts:720-730`.

3. **Follower snapshot backend dependency undocumented** — `followerSnapshotsStore.takeSnapshotIfNeeded()` calls `$BACKEND_URL/api/social-followers` but this endpoint's reliability/rate-limits aren't documented. If backend is down, snapshots silently fail. Low severity. `followerSnapshotsStore.ts:80-118`.

4. **Deep-link look fetch lacks error toast** — `look/[id].tsx:147-162` fetches from Supabase on cache miss but only shows "not found" state. Network errors show same "not available" message with no retry. Low severity. `look/[id].tsx:147-172`.

5. **Draft persistence can resurrect deleted looks** — If a creator deletes a look but has draft state persisted in AsyncStorage from an earlier edit session, reopening Create may attempt to pre-populate from a deleted look. Edge case. `draftLookStore` + `create.tsx:204-217`.

---

## Appendix: Metadata Fetch Pipeline

```
User pastes URL
     │
     ▼
fetchProductInfo()   (src/lib/utils/fetchProductInfo.ts:359)
     │
     ├─ Tier 1: fetchDirect()         HTML → JSON-LD / OG / Twitter     8s timeout
     │     └─ if useful → return
     │
     ├─ Tier 2: fetchFromBackend()    /api/product-info (ScrapingBee)   20s timeout
     │     └─ if useful → return
     │
     ├─ Tier 3: fetchFromMicrolink()  api.microlink.io                  10s timeout
     │     └─ if useful → return
     │
     ├─ Tier 4: fetchFromJsonlink()   jsonlink.io                       10s timeout
     │     └─ if useful → return
     │
     └─ Fallback: best partial result or empty
```

Each tier logs to `metadata_fetch_logs` for domain-level success rate analysis.
