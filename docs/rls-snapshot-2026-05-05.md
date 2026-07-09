# RLS Policy Snapshot — 2026-05-05

Captured directly from `pg_policies` against prod Supabase project `rghlcnrttvlvphzahudf` on 2026-05-05. Use this as the baseline for detecting future drift. Re-generate by running:

```sql
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public','storage','auth')
ORDER BY schemaname, tablename, policyname;
```

## public schema

### app_metadata

- **app_metadata public read** — SELECT to `{anon,authenticated}` — `USING (true)`

### audience_accounts

- **Users can insert their own audience account** — INSERT to `{public}` — `WITH CHECK (auth.uid() = id)`
- **Users can update their own audience account** — UPDATE to `{public}` — `USING (auth.uid() = id)`
- **Users can view their own audience account** — SELECT to `{public}` — `USING (auth.uid() = id)`

### categories

- **Categories are viewable by everyone** — SELECT to `{public}` — `USING (true)`

### click_events

- **Anyone can log clicks** — INSERT to `{public}` — `WITH CHECK (EXISTS (SELECT 1 FROM looks l WHERE l.id = click_events.look_id AND l.archived = false))`
- **Creators can view clicks on their looks** — SELECT to `{public}` — `USING (EXISTS (SELECT 1 FROM looks WHERE looks.id = click_events.look_id AND looks.creator_id = auth.uid()))`

### commissions

- **creators read own commissions** — SELECT to `{public}` — `USING (creator_id = auth.uid())`
- **service role manages commissions** — ALL to `{public}` — `USING (auth.role() = 'service_role')`

### creator_backdrops

- **creator_backdrops public read** — SELECT to `{authenticated}` — `USING (active = true)`

### creator_items

- **Creator items are viewable by everyone** — SELECT to `{public}` — `USING (true)`
- **Creators can delete their own items** — DELETE to `{public}` — `USING (creator_id = auth.uid())`
- **Creators can insert their own items** — INSERT to `{public}` — `WITH CHECK (creator_id = auth.uid())`
- **Creators can update their own items** — UPDATE to `{public}` — `USING (creator_id = auth.uid())`

### creator_profiles

- **Profiles are viewable by everyone** — SELECT to `{public}` — `USING (true)`
- **Users can insert their own profile** — INSERT to `{public}` — `WITH CHECK (auth.uid() = creator_id)`
- **Users can update their own profile** — UPDATE to `{public}` — `USING (auth.uid() = creator_id)`

### creator_web_invites

- **creator_web_invites self select** — SELECT to `{anon,authenticated}` — `USING (true)`

### creators

- **Creators are viewable by everyone** — SELECT to `{public}` — `USING (true)`
- **Users can insert their own creator record** — INSERT to `{public}` — `WITH CHECK (auth.uid() = id)`
- **Users can update their own creator record** — UPDATE to `{public}` — `USING (auth.uid() = id)`

### follower_snapshots

- **Creators can insert own snapshots** — INSERT to `{public}` — `WITH CHECK (auth.uid() = creator_id)`
- **Creators can read own snapshots** — SELECT to `{public}` — `USING (auth.uid() = creator_id)`

### likes

- **Users can delete their own likes** — DELETE to `{public}` — `USING (auth.uid() = user_id)`
- **Users can insert their own likes** — INSERT to `{public}` — `WITH CHECK (auth.uid() = user_id)`
- **Users can view their own likes** — SELECT to `{public}` — `USING (auth.uid() = user_id)`

### look_events

- **authenticated users insert events** — INSERT to `{public}` — `WITH CHECK (auth.role() = 'authenticated')`
- **creators read own events** — SELECT to `{public}` — `USING (creator_id = auth.uid())`

### look_items

- **Creators can delete look items for their looks** — DELETE to `{public}` — `USING (EXISTS (SELECT 1 FROM looks WHERE looks.id = look_items.look_id AND looks.creator_id = auth.uid()))`
- **Creators can insert look items for their looks** — INSERT to `{public}` — `WITH CHECK (EXISTS (SELECT 1 FROM looks WHERE looks.id = look_items.look_id AND looks.creator_id = auth.uid()))`
- **Creators can update look items for their looks** — UPDATE to `{public}` — `USING (EXISTS (SELECT 1 FROM looks WHERE looks.id = look_items.look_id AND looks.creator_id = auth.uid()))`
- **Look items are viewable by everyone** — SELECT to `{public}` — `USING (true)`

### looks

- **Creators can delete their own looks** — DELETE to `{public}` — `USING (auth.uid() = creator_id)`
- **Creators can insert their own looks** — INSERT to `{public}` — `WITH CHECK (auth.uid() = creator_id)`
- **Creators can update their own looks** — UPDATE to `{public}` — `USING (auth.uid() = creator_id)`
- **Creators can view their own looks** — SELECT to `{public}` — `USING (auth.uid() = creator_id)`
- **Public can view published looks** — SELECT to `{public}` — `USING (archived = false AND published_at IS NOT NULL)`

### metadata_fetch_logs

- **metadata_fetch_logs_insert_self** — INSERT to `{authenticated}` — `WITH CHECK (creator_id = auth.uid() OR creator_id IS NULL)`

### payouts

- **creators read own payouts** — SELECT to `{public}` — `USING (creator_id = auth.uid())`
- **service role manages payouts** — ALL to `{public}` — `USING (auth.role() = 'service_role')`

### render_quota

- **render_quota own select** — SELECT to `{authenticated}` — `USING (user_id = auth.uid())`

### vto_renders

- **vto_renders own insert** — INSERT to `{authenticated}` — `WITH CHECK (user_id = auth.uid())`
- **vto_renders own select** — SELECT to `{authenticated}` — `USING (user_id = auth.uid())`
- **vto_renders own update saved** — UPDATE to `{authenticated}` — `USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())`

## storage schema (objects)

### profile-photos bucket

- **Authenticated users can upload profile photos** — INSERT to `{authenticated}` — `WITH CHECK (bucket_id = 'profile-photos')`
- **Users can update their own profile photos** — UPDATE to `{authenticated}` — `USING (bucket_id = 'profile-photos')`
- **Users can delete their own profile photos** — DELETE to `{authenticated}` — `USING (bucket_id = 'profile-photos')`
- **profile-photos select public** — SELECT to `{public}` — `USING (bucket_id = 'profile-photos')`
- **profile-photos insert authenticated** — INSERT to `{authenticated}` — `WITH CHECK (bucket_id = 'profile-photos')`
- **profile-photos update owner** — UPDATE to `{authenticated}` — `USING (bucket_id = 'profile-photos' AND owner = auth.uid())`
- **profile-photos delete owner** — DELETE to `{authenticated}` — `USING (bucket_id = 'profile-photos' AND owner = auth.uid())`

### look-photos bucket

- **Authenticated users can upload look photos** — INSERT to `{authenticated}` — `WITH CHECK (bucket_id = 'look-photos')`
- **Users can update their own look photos** — UPDATE to `{authenticated}` — `USING (bucket_id = 'look-photos')`
- **Users can delete their own look photos** — DELETE to `{authenticated}` — `USING (bucket_id = 'look-photos')`
- **look-photos select public** — SELECT to `{public}` — `USING (bucket_id = 'look-photos')`
- **look-photos insert authenticated** — INSERT to `{authenticated}` — `WITH CHECK (bucket_id = 'look-photos')`
- **look-photos update owner** — UPDATE to `{authenticated}` — `USING (bucket_id = 'look-photos' AND owner = auth.uid())`
- **look-photos delete owner** — DELETE to `{authenticated}` — `USING (bucket_id = 'look-photos' AND owner = auth.uid())`

### item-photos bucket

- **Authenticated users can upload item photos** — INSERT to `{authenticated}` — `WITH CHECK (bucket_id = 'item-photos')`
- **Users can update their own item photos** — UPDATE to `{authenticated}` — `USING (bucket_id = 'item-photos')`
- **Users can delete their own item photos** — DELETE to `{authenticated}` — `USING (bucket_id = 'item-photos')`
- **item-photos select public** — SELECT to `{public}` — `USING (bucket_id = 'item-photos')`
- **item-photos insert authenticated** — INSERT to `{authenticated}` — `WITH CHECK (bucket_id = 'item-photos')`
- **item-photos update owner** — UPDATE to `{authenticated}` — `USING (bucket_id = 'item-photos' AND owner = auth.uid())`
- **item-photos delete owner** — DELETE to `{authenticated}` — `USING (bucket_id = 'item-photos' AND owner = auth.uid())`

### cutouts bucket

- **cutouts select public** — SELECT to `{public}` — `USING (bucket_id = 'cutouts')`
- **cutouts selfie insert own** — INSERT to `{authenticated}` — `WITH CHECK (bucket_id = 'cutouts' AND foldername[1] = 'selfies' AND foldername[2] = auth.uid()::text)`
- **cutouts selfie update own** — UPDATE to `{authenticated}` — same path lock
- **cutouts selfie delete own** — DELETE to `{authenticated}` — same path lock
- **cutouts look-photos insert own** — INSERT to `{authenticated}` — `WITH CHECK (bucket_id = 'cutouts' AND foldername[1] = 'look-photos' AND foldername[2] = auth.uid()::text)`
- **cutouts look-photos update own** — UPDATE to `{authenticated}` — same path lock
- **cutouts look-photos delete own** — DELETE to `{authenticated}` — same path lock

## auth schema

No custom policies (only Supabase-managed defaults).

## Notes for review

- `audience_accounts`, `creator_profiles`, `creators`, `creator_items`, `commissions`, `payouts`, `looks`, `look_items`, `look_events`, `click_events`, `likes`, `follower_snapshots` all have `roles = {public}` rather than `{authenticated}`. The `auth.uid() = ...` predicates make this safe (anon callers fail the predicate), but the convention should be `{authenticated}` going forward — file a follow-up to tighten on a future security sweep.
- `creator_web_invites` uses `USING (true)` for SELECT to anon. Intentional — the table is an email allowlist with no credentials, and the signup form server-validates after fetching by email. Documented in the migration.
- `app_metadata` uses `USING (true)` for SELECT to anon+authenticated. Intentional — version label table read by all clients before login.
- `vto_renders` has a `BEFORE UPDATE` trigger (`vto_renders_guard_update`) that enforces column-level immutability for authenticated users (only `saved_at` may change). This is on top of the RLS UPDATE policy.
- `security_events` has RLS enabled with **no policies** — only service_role and postgres can read/write. Intentional.
- `render_quota` has a SELECT policy but no INSERT/UPDATE/DELETE for users — writes happen via service_role only via `consume_render_quota()` RPC.
