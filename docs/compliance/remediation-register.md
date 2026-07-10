# Security Remediation Register

Source: Supabase security advisors, full run 2026-07-09 (209 findings).
Status values: ✅ fixed · 🔒 risk-accepted (documented) · ⏳ open.

## Criticals (ERROR)

| # | Finding | Objects | Status |
|---|---|---|---|
| 1 | Tables exposed with no RLS (readable/**writable** with the public anon key) | product_info_cache, candidate_fashion_weights, campaign_category_exclusions/includes, discovery_cursor, trr_campaign_log, cc_campaigns, partnerboost_link_cache, campaign_candidates | ✅ fixed 2026-07-09 (`security_baseline_lockdown_p1`) — RLS on, service-role only |
| 2 | Same, but plausibly web-read reference data | vibe_aliases, brand_pins | ✅ fixed — RLS on, explicit public **read-only** policy (writes blocked) |
| 3 | Sensitive column (`token`) exposed via API | candidate_fashion_weights | ✅ fixed (covered by #1) |
| 4 | Per-creator earnings world-readable | creator_cj_earnings view | ✅ fixed — anon/authenticated SELECT revoked; clients use auth-gated RPCs |
| 5 | SECURITY DEFINER views (bypass base-table RLS) | creator_profiles_public, creator_profiles_completion, affiliate_merchants, affiliate_products_live/raw, v_pending_candidates, v_pending_products, v_priority_creators | ⏳ review each: some are deliberate public reference surfaces (affiliate_merchants, creator_profiles_public — likely 🔒 accept with comment); admin `v_*` views likely need access narrowed |

## High-priority warnings

| # | Finding | Scale | Plan |
|---|---|---|---|
| 6 | `admin_*` SECURITY DEFINER functions executable by anon **and** any signed-in user (click analytics, gap reports, etc.) | ~46 functions | Per-function triage: keep `add_to_waitlist` (marketing form needs anon); revoke anon on all `admin_*`; add role/allow-list gate inside admin functions before revoking `authenticated` (creators-web admin uses an authenticated session) |
| 7 | Storage buckets allow public **listing** (enumeration) | cutouts, item-photos, look-photos, profile-photos | Keep public object READ (app needs it); disable list; verify app image loading after |
| 8 | `share_beacon` RLS policy is `true` (world-writable) | 1 table | July share-ext diagnostic; verify the shipped extension's beacon writes, then tighten or drop table |
| 9 | Leaked-password protection disabled | Auth setting | **Nicole**: Supabase Dashboard → Authentication → Passwords → enable "leaked password protection" (one toggle) |
| 10 | Functions with mutable search_path | 60 functions | Mechanical batch: `alter function … set search_path = ''` (or pinned), verify signatures; do as one migration |
| 11 | Materialized views in API | affiliate_products, affiliate_merchant_product_counts | Check anon SELECT need; restrict if server-only |
| 12 | pg_trgm extension in public schema | 1 | Move to `extensions` schema when convenient (low risk) |

## Accepted / informational

- 26 × `rls_enabled_no_policy` (INFO): expected state for service-role-only
  tables — RLS on + no policies **is** the lockdown. 🔒 accepted by design.

## Cadence

Re-run advisors after every schema change and at least monthly during the
migration; append new findings here with dates.
