-- Companion to 20260605210000_brand_storefronts_memberships.sql.
-- Seeds:
--   * Founder admin flags (Nicole, Kerri)
--   * Golden Bear Garage launch partner storefront (Billy=owner, Kerri=stylist)
--   * Test Brand QA storefront (Jade=owner, Mia=stylist; is_test=true)
--
-- Applied to prod via Supabase MCP on 2026-06-05; this file mirrors it for VCS.
-- See ./20260605210500_brand_storefronts_is_test.sql for the is_test column
-- this seed depends on.

-- 0. Promote founders to admin.
update public.creator_profiles set is_admin = true
 where creator_id in (
   '343e4391-d734-4f0a-a3ae-c219dbc13695', -- Nicole
   '8390038f-f0be-426c-8b08-8716042282c5'  -- Kerri
 );

-- 1. Golden Bear Garage storefront content account.
insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  'b9909999-0001-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'goldenbear-storefront@styledinmotion.app',
  null, now(),
  '{"provider":"system","providers":["system"],"storefront":"golden-bear-garage"}'::jsonb,
  '{"system_account":true,"display_name":"Golden Bear Garage"}'::jsonb,
  now(), now()
) on conflict (id) do nothing;

insert into public.creators (id, email, name, first_name, last_name, amazon_tracking_id)
values (
  'b9909999-0001-4000-8000-000000000001',
  'goldenbear-storefront@styledinmotion.app',
  'Golden Bear Garage', 'Golden Bear', 'Garage',
  'styledinmotio-goldenbear-20'
) on conflict (id) do nothing;

insert into public.creator_profiles (
  creator_id, username, account_type, bio, is_seed,
  amazon_own_tag_enabled, amazon_associates_tag
) values (
  'b9909999-0001-4000-8000-000000000001',
  'goldenbeargarage',
  'partner_brand',
  'Vintage-leaning menswear & gear from Golden Bear Garage.',
  false,
  true,
  'styledinmotio-goldenbear-20'
) on conflict (creator_id) do update
  set account_type = excluded.account_type,
      amazon_own_tag_enabled = excluded.amazon_own_tag_enabled,
      amazon_associates_tag  = excluded.amazon_associates_tag;

insert into public.brand_storefronts (
  id, storefront_creator_id, name, slug, brand_story, logo_url,
  commission_pct, promo_code, fulfillment, contact_email, status, is_test
) values (
  'a0a00001-9001-4001-8001-000000000001',
  'b9909999-0001-4000-8000-000000000001',
  'Golden Bear Garage', 'golden-bear-garage',
  'Golden Bear Garage is a vintage-leaning men''s style & gear shop curated by Billy Gorey. Each piece is hand-picked for character, fit, and stories worth wearing.',
  null,           -- logo upload pending (Supabase Storage step)
  15, null, '[]'::jsonb, 'goldenbeargarage@gmail.com', 'active', false
) on conflict (id) do nothing;

insert into public.brand_memberships (creator_id, brand_id, role, status, assigned_by) values
  ('94d360ab-ab7b-4ff1-b84d-10f36610115a','a0a00001-9001-4001-8001-000000000001','owner','active','343e4391-d734-4f0a-a3ae-c219dbc13695'),
  ('8390038f-f0be-426c-8b08-8716042282c5','a0a00001-9001-4001-8001-000000000001','stylist','active','343e4391-d734-4f0a-a3ae-c219dbc13695')
on conflict (creator_id, brand_id) do nothing;

-- 2. Test Brand storefront — QA twin.
insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  'b9909999-0002-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'testbrand-storefront@styledinmotion.app',
  null, now(),
  '{"provider":"system","providers":["system"],"storefront":"test-brand","is_test":true}'::jsonb,
  '{"system_account":true,"is_test":true,"display_name":"Test Brand"}'::jsonb,
  now(), now()
) on conflict (id) do nothing;

insert into public.creators (id, email, name, first_name, last_name, amazon_tracking_id)
values (
  'b9909999-0002-4000-8000-000000000002',
  'testbrand-storefront@styledinmotion.app',
  'Test Brand', 'Test', 'Brand',
  'styledinmotio-testbrand-20'
) on conflict (id) do nothing;

insert into public.creator_profiles (
  creator_id, username, account_type, bio, is_seed,
  amazon_own_tag_enabled, amazon_associates_tag
) values (
  'b9909999-0002-4000-8000-000000000002',
  'testbrand',
  'partner_brand',
  'Synthetic QA storefront — not for shopper traffic.',
  true,
  true,
  'styledinmotio-testbrand-20'
) on conflict (creator_id) do update
  set account_type = excluded.account_type,
      is_seed = excluded.is_seed,
      amazon_own_tag_enabled = excluded.amazon_own_tag_enabled,
      amazon_associates_tag  = excluded.amazon_associates_tag;

insert into public.brand_storefronts (
  id, storefront_creator_id, name, slug, brand_story, logo_url,
  commission_pct, promo_code, fulfillment, contact_email, status, is_test
) values (
  'a0a00002-9002-4002-8002-000000000002',
  'b9909999-0002-4000-8000-000000000002',
  'Test Brand', 'test-brand',
  'Internal QA storefront for verifying brand storefront flows end-to-end.',
  null, 15, null, '[]'::jsonb, 'nicole@styledinmotion.app', 'active', true
) on conflict (id) do nothing;

insert into public.brand_memberships (creator_id, brand_id, role, status, assigned_by) values
  ('b2222222-2222-2222-2222-222222222222','a0a00002-9002-4002-8002-000000000002','owner','active','343e4391-d734-4f0a-a3ae-c219dbc13695'),
  ('a1111111-1111-1111-1111-111111111111','a0a00002-9002-4002-8002-000000000002','stylist','active','343e4391-d734-4f0a-a3ae-c219dbc13695')
on conflict (creator_id, brand_id) do nothing;
