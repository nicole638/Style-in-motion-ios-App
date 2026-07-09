---
name: shopper-account-type-dual-meaning
description: "shopper" means TWO different things in this codebase — don't conflate them
metadata:
  type: project
---

"shopper" is overloaded in this repo — verify which one before touching code:

1. **Audience persona (old/pervasive):** the consumer who browses & taps affiliate links. Modeled as `authStore.userType='audience'`, stored in `audience_accounts`, `user_metadata.user_type='audience'`. Appears in click_events/VTO/discovery naming ("shopper taps", "shopper-side reads").
2. **Shopper closet (new, 2026-07-02):** an audience user who opened a personal closet gets a `creators` row tagged **`creators.account_type='shopper'`** (default `'creator'`; CHECK also allows `'partner_brand'`). This reuses the creator closet/collage pipeline. Their looks stay private (`published_at` always NULL); excluded from creator analytics/nudges/directory.

`creators.account_type` was applied to prod via Supabase MCP but was **unmirrored** until `supabase/migrations/20260702120000_creators_account_type_shopper.sql` (idempotent; drops any old account_type check on creators, recreates allowing the 3 values). Prod already accepts `'shopper'` (verified via reverted probe). Apply the migration to prod (db push) to keep `supabase db diff` empty per [[schema-discipline]].

Shopper closet impl lives in mobile: `authStore.ensureShopperCloset()` / `promoteToCreator()`, `(public-tabs)/closet.tsx`, `add-closet-photos.tsx`, and `isShopper` branches in `collage-builder.tsx` + `(tabs)/shop.tsx`. Cutouts fire via the deployed-only `cutout-item-photo` edge function (not in `supabase/functions/`).
