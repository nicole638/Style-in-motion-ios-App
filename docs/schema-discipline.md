# Schema Discipline

**Rule:** All schema changes go through `supabase/migrations/`. No Studio edits to prod without a paired migration file. CI will fail if `supabase db diff` returns a non-empty result.

## Why this rule exists

We hit drift on 2026-05-05: features merged over the prior ~14 days (founding-creator badge, alternate-photo JSONB conversion, body/sizes profile fields, vto_renders + render_quota, creator_backdrops, etc.) implied schema changes, but several were applied directly in Studio against prod without a corresponding migration file. This made it impossible for a fresh dev environment to reach prod parity, and made rollback by file-revert impossible. The catch-up migration is `supabase/migrations/20260505_catchup_drift.sql`.

## How to make a schema change

1. Write the migration file first: `supabase/migrations/<YYYYMMDD>_<short_description>.sql`. Use `IF NOT EXISTS` / `OR REPLACE` so it is idempotent.
2. Apply it locally / on a preview DB (`supabase db push` or your dev runner).
3. Open a PR. Reviewer checks the migration body, not Studio screenshots.
4. After merge, the prod runner applies the migration. **Do not** open Studio and click around to "fix" it afterwards.

## What counts as a schema change

- New table, view, materialized view, function, trigger, type, sequence, extension
- Column add/drop/rename, type change, default change, nullability change, check constraint
- Index add/drop
- Foreign key add/drop/rename
- RLS policy add/drop/alter, RLS enable/disable on a table
- Grants/revokes on schema, table, sequence, function

If you are not sure whether a change counts: it counts.

## What does NOT go in `supabase/migrations/`

- One-off data corrections. Run those as a scripted SQL file under `scripts/db/<date>-<reason>.sql`, document who ran it and when, and put it in PR description, not the migrations folder. Migrations should be pure DDL.
- Edge function code. Edge functions live under `supabase/functions/<name>/`. They have their own deploy pipeline (`supabase functions deploy`). They are still code that must be checked in, just not under `migrations/`.

## Forbidden in prod

- Studio table editor edits to columns, indexes, or RLS policies.
- `psql` against prod for DDL by humans, ever. Read-only `\d` / `SELECT` is fine for diagnosis.
- "Just this once" tweaks. Every "just this once" is how 20260505 happened.

## CI gate

The CI job `db-drift` runs `supabase db diff --use-migra --linked --schema public` against the prod DB after the migrations folder is replayed onto a clean DB. If the diff is non-empty, CI fails with the diff in the log. The fix is always: write a migration file capturing the missing change, never silence the gate.

If you need to land a change urgently and the CI gate is blocking, the right path is to write the migration file and merge it — not to bypass the gate. The gate exists because skipping it is exactly what got us into the mess this doc was written to prevent.

## On RLS policies specifically

RLS policies are schema. They go in migration files. Do not edit them in Studio. To snapshot current prod policies, run:

```bash
psql "$DATABASE_URL" -c "select schemaname, tablename, policyname, roles, cmd, qual, with_check from pg_policies order by schemaname, tablename, policyname" -o docs/rls-snapshot-$(date +%Y-%m-%d).txt
```

and commit the output. Re-snapshot whenever a policy migration lands.
