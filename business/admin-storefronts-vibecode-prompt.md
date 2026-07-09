# Vibecode Prompt: creators-web `/admin/storefronts` section

This file is a **ready-to-paste prompt** for Vibecode to build the partner-brand
admin surface in the existing creators-web Next.js app. The schema, RLS, and
seed data the prompt depends on are already live in the
`StyledinMotion Project` Supabase project (`rghlcnrttvlvphzahudf`) as of
2026-06-05; see `mobile/CHANGES.md` §6e for the full history.

**Hand it to Vibecode as one message. No edits needed.**

---

## Prompt to paste into Vibecode

> Build a new admin section at `/admin/storefronts` in the existing Next.js
> creators-web app. It manages **partner brand storefronts** — persistent
> brand accounts (Golden Bear Garage is the first) where SiM earns a 15%
> commission on traffic. A *storefront* is a separate `creator_profiles`
> account (`account_type='partner_brand'`) that owns its own looks and items;
> humans access it through `brand_memberships` rows assigning them an
> `owner | stylist | analyst` role.
>
> All schema, RLS, and seeds are **already in place** — do not write
> migrations. Tables and key columns:
>
> - `brand_storefronts(id, storefront_creator_id, name, slug, brand_story,
>   logo_url, commission_pct, promo_code, fulfillment jsonb, contact_email,
>   status text, is_test boolean, created_at, updated_at)`
>   — status ∈ {active, paused, archived}; commission_pct CHECK 0–100;
>   fulfillment shape `[{channel: 'etsy'|'ebay'|'shopify', url: text}, …]`.
> - `brand_memberships(id, creator_id, brand_id, role, status text,
>   assigned_by, assigned_at)` — role ∈ {owner, stylist, analyst};
>   status ∈ {active, paused, revoked}; UNIQUE (creator_id, brand_id).
> - `creator_profiles.account_type` ∈ {creator, partner_brand}.
> - `creator_profiles.is_admin boolean` — **this is the gate.**
> - `looks.authored_by`, `creator_items.authored_by` — uuid → creator_profiles,
>   credit the human who built a brand row.
>
> RLS already in place: brand_storefronts and brand_memberships both have
> `*_admin_all` policies that check `exists (select 1 from creator_profiles
> where creator_id = auth.uid() and is_admin = true)`. So **the middleware
> MUST read `is_admin` from the DB (NOT an env-var allowlist)** — otherwise
> admin reads will pass but every write returns RLS denied. There is no env
> fallback.
>
> ### Section structure (4 routes)
>
> 1. **`/admin/storefronts`** — list view.
>    - Table columns: logo (thumb), name, slug, commission %, status pill,
>      is_test flag, member count, created_at.
>    - Filter pills above the table: `All | Active | Paused | Archived`,
>      plus a toggle "Show test brands" (default off — hides
>      `is_test=true`).
>    - "+ New storefront" button → `/admin/storefronts/new`.
>    - Row click → `/admin/storefronts/[id]`.
>
> 2. **`/admin/storefronts/new`** — create form.
>    - Fields: name (required), slug (required, lowercase-dash, unique),
>      brand_story (multiline), logo_url (file upload to Supabase Storage
>      bucket `profile-photos/<storefront_creator_id>/profile.jpg`),
>      commission_pct (number 0–100, default 15), promo_code,
>      contact_email (required), is_test (checkbox).
>    - Fulfillment: repeating row of `{channel select, url text}` —
>      add/remove rows; persist as a jsonb array.
>    - **Server action does the multi-table insert atomically** via a
>      Postgres function or a single PL/pgSQL block: creates a synthetic
>      `auth.users` row (uuid + email pattern
>      `<slug>-storefront@styledinmotion.app`, system metadata),
>      `creators` row (with `amazon_tracking_id` derived from slug, e.g.
>      `styledinmotio-goldenbear-20`), `creator_profiles` row
>      (`account_type='partner_brand'`, `amazon_own_tag_enabled=true`,
>      `amazon_associates_tag` = same as creators.amazon_tracking_id), and
>      finally the `brand_storefronts` row. See
>      `supabase/migrations/20260605211000_seed_golden_bear_garage.sql` for
>      the working pattern — replicate it as a server action that takes the
>      form fields.
>    - After create → redirect to `/admin/storefronts/[id]`.
>
> 3. **`/admin/storefronts/[id]`** — detail/edit + memberships.
>    - Top section: editable fields (name, brand_story, logo_url,
>      commission_pct, promo_code, fulfillment, contact_email, status,
>      is_test). Save = single update to brand_storefronts.
>    - Memberships section: table of current members (name, email, role,
>      status, assigned_at). Add-member form: email lookup → returns
>      `creator_profiles` row (must already exist as a creator account) →
>      role select (owner/stylist/analyst) → insert into brand_memberships
>      with `assigned_by = auth.uid()`. Per-row actions: change role,
>      pause/resume, revoke.
>    - "Logo" upload control replaces the storage object at the same path
>      so existing `logo_url` / `photo_url` references keep working.
>    - Earnings summary: total commissions YTD, grouped by stylist
>      (via `commissions` joined to `click_events` joined to `looks`,
>      grouped by `looks.authored_by`). Read-only.
>
> 4. **`/admin/storefronts/[id]/danger`** — soft-archive.
>    - Sets `brand_storefronts.status='archived'`. Public surfaces hide
>      the storefront's looks; admin keeps full visibility. Memberships are
>      left intact (revoke individually if needed). Hard-delete is **not
>      implemented** — archived storefronts retain their commission history.
>
> ### Middleware
>
> - Reuse the existing `/admin` middleware shell (it already gates the
>   campaigns / awin-merchants / brand-partnerships routes).
> - Gating logic: `auth.getUser()` → look up `creator_profiles.is_admin`
>   → 404 if false (NOT 401 — we don't reveal that the admin section
>   exists).
> - **Do not use an env-var allowlist.** The brand_* RLS policies expect
>   `is_admin=true` on the DB row and will reject writes from any other
>   user even if middleware lets them through.
>
> ### Storage
>
> - Bucket `profile-photos` (public, already exists).
> - Storefront logo path convention:
>   `profile-photos/<storefront_creator_id>/profile.jpg`.
> - On upload, also update `creator_profiles.photo_url` so the byline avatar
>   matches the storefront page header.
>
> ### UI / branding
>
> - Match the existing creators-web admin look (Tailwind, same nav shell).
> - Status pill colors: active=green, paused=amber, archived=gray, is_test
>   adds a small "test" label.
>
> ### Existing fixtures you can preview against
>
> - **Golden Bear Garage** — id `a0a00001-9001-4001-8001-000000000001`,
>   slug `golden-bear-garage`. Members: Billy Gorey (owner),
>   Kerri Daly (stylist).
> - **Test Brand** — id `a0a00002-9002-4002-8002-000000000002`, slug
>   `test-brand`, `is_test=true`. Members: Jade Kim (owner),
>   Mia Santos (stylist).
> - Admin DB-flagged users: Nicole Wise
>   (`343e4391-d734-4f0a-a3ae-c219dbc13695`),
>   Kerri Daly (`8390038f-f0be-426c-8b08-8716042282c5`).
>
> ### Out of scope for this build
>
> - Public-facing `/brand/<slug>` shopper landing page (separate spec).
> - Mobile iOS context-switcher (already built; see CHANGES.md §6e).
> - Commission rate history / audit log (commission_pct is mutable today;
>   tracking changes is a v1.1 ask).
> - Bulk membership import.
>
> ### Tests
>
> - Cover: storefront create roundtrip (form → DB → list shows it);
>   role-change atomicity; non-admin user gets 404; archived storefront
>   disappears from public discover feed (verify by querying
>   `get_looks_by_vibe` with no filters — archived brand's looks should
>   not appear).
>
> Reference files when implementing:
> - `supabase/migrations/20260605210000_brand_storefronts_memberships.sql`
> - `supabase/migrations/20260605210500_brand_storefronts_is_test.sql`
> - `supabase/migrations/20260605211000_seed_golden_bear_garage.sql`
> - `supabase/migrations/20260605220000_get_looks_by_vibe_brand_aware.sql`
> - `mobile/src/lib/state/contextStore.ts` (parallel iOS context model)
> - `mobile/CHANGES.md` §6e + §6f (full design history)

---

## Why this prompt is shaped this way

- **Inline schema instead of "read the docs":** Vibecode prompts work best
  when the data model is on the page. The agent doesn't have to chase files.
- **The `is_admin` warning is top-of-prompt:** the single most likely failure
  mode is middleware that gates on env-var while RLS gates on the DB column.
  Calling it out twice (intro + middleware section) is intentional.
- **Working fixtures named:** "preview against Golden Bear Garage" gives the
  agent a concrete success target. Same for the Test Brand for QA flows.
- **Storage path convention pinned:** the iOS app already references
  `profile-photos/<storefront_creator_id>/profile.jpg` literally. If the
  admin upload writes elsewhere the avatar breaks.
- **Out-of-scope list is explicit:** prevents scope creep into the public
  shopper page or mobile parity work, which are separately tracked.
