# Styled in Motion — Security & Compliance Baseline

Standing requirement (Nicole, 2026-07-09): build toward **SOC 2** and **ISO 27001**
compliance. This folder is the living record: what controls exist, what's being
fixed, and the evidence trail an auditor will ask for.

## What SOC 2 / ISO 27001 actually require of us

Both are audits of **controls + evidence**, not code features. Roughly half is
technical (this repo's responsibility), half is organizational (policies,
vendor list, device management, incident response — Nicole's side, usually run
through a platform like Vanta / Drata / Secureframe when it's time to certify).

**Technical control themes we build against** (SOC 2 Trust Services Criteria ↔
ISO 27001 Annex A):

| Theme | What it means here |
|---|---|
| Access control / least privilege | RLS on every exposed table; auth-gated RPCs; service-role keys only server-side; no shared accounts |
| Encryption | TLS everywhere (Supabase/Vercel default); at-rest via Supabase (AES-256) |
| Change management | All schema changes via `supabase/migrations/` in git; app changes via GitHub commits/PRs; no console edits without a paired migration |
| Audit logging | `click_events` (+ `served_by` origin), Supabase auth logs, edge-function logs, migration history |
| Vendor management | Off-boarding Vibecode (unaudited third party with production access) — see MIGRATION-PLAN in the 2026-07-09 export |
| Secrets management | No secrets in git (enforced by `.gitignore` + clean history); Supabase function secrets / EAS secrets; rotation at migration cutover |
| Data privacy | Creator earnings / PII locked to owner-gated access; `delete-account` function for erasure requests |
| Vulnerability management | Supabase security advisors run + triaged (see remediation register); repeat after schema changes |

## Working rules (every change, going forward)

1. **RLS-first**: any new table gets RLS + explicit policies in the same migration.
2. **Public views/functions are deliberate**: anything readable by `anon` must be
   justified in a comment; per-user data only via `auth.uid()`-gated RPCs.
3. **No secrets in git, ever.** `.env.example` documents names; values live in
   Supabase/EAS secret stores.
4. **Migrations are the only path to schema change** (repo rule, pre-existing).
5. **Advisor sweep after DDL**: run Supabase security advisors after schema work;
   new findings go into the register, criticals fixed before shipping.
6. **Test data is cleaned**: verification rows are tagged and deleted (practiced
   in the 2026-07-09 parity tests).

## Evidence log

- **2026-07-09** — Codebase exported from Vibecode; new repo created with clean
  history, secrets excluded and scanned (`d2dec7e`). Vendor off-boarding started.
- **2026-07-09** — Full security-advisor audit: 209 findings (21 ERROR / 162
  WARN / 26 INFO). Register created (below).
- **2026-07-09** — `security_baseline_lockdown_p1` migration: RLS enabled on 11
  exposed tables (incl. one with an exposed `token` column and the poisonable
  `partnerboost_link_cache`); `creator_cj_earnings` (per-creator financial
  data, previously world-readable) restricted to service role. 13 of 21
  criticals closed. Zero client impact (usage-scanned first; money path
  regression-tested on both backends after).
- **2026-07-09** — `click_events.served_by` marker added: complete origin
  audit trail for the revenue path during the backend migration.
- **2026-07-09** — Leaked-password protection enabled (Supabase Auth →
  Attack Protection, by Nicole). Client UX updated to match: signup screens and
  the password-reset screen now explain a breach rejection in plain language
  ("appeared in a known data breach") instead of a misleading length error or
  a generic failure loop. Sign-ins are unaffected by design (no lockouts).
