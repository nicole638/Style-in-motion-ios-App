---
name: otp-email-template-requires-token
description: In-app 6-digit OTP signup verification silently breaks unless the Supabase Confirm-signup email template includes {{ .Token }}
metadata:
  type: project
---

The app's in-app signup verification (`src/app/auth/verify.tsx` + `verifySignupOtp` in `authStore.ts`, `verifyOtp` type `'signup'`) needs the user to type a 6-digit code from their confirmation email. This works for BOTH audience (shopper) and creator signup — both route to the same code screen.

The Supabase **"Confirm signup" email template MUST emit `{{ .Token }}`** (the 6-digit code) alongside the confirmation link. On 2026-07-03 the template had only the link and no token, so the code-entry screen had nothing to type — the creator OTP flow had been silently broken this whole way, and it also blocked the newly-restored shopper OTP flow. The token was added to the template to fix it.

**Why:** the template lives in the Supabase dashboard, not the repo — nothing in code or CI catches its absence, and the failure is silent (email arrives, code screen looks fine, but no code exists to enter).

**How to apply:** if the in-app OTP flow ever fails again (code screen with no code in the email), or when setting up a new Supabase environment, verify the Confirm-signup template includes `{{ .Token }}`. The confirmation LINK is the fallback path (handled in `_layout.tsx` deep-link handler → auto-sign-in), so link-only emails still work but defeat the no-browser-hop goal. Related: [[shopper-account-type-dual-meaning]].
