-- RLS tier verification (PRD §13).
-- Run in the Supabase SQL editor (or psql as postgres). Simulates each role's
-- JWT claims exactly as PostgREST presents them, then checks what each role
-- can see. Read-only; each block resets the role afterwards.
--
-- Expected results:
--   staff      -> class O rows visible, class P counts = 0, pricing fn = true
--   sales_rep  -> all counts 0 (ownership scoping lands in Phase 4),
--                 pricing fn = false unless profiles.can_view_contract_price
--   admin      -> everything visible, pricing fn = true
--   anon       -> ERROR: permission denied (no grants)
--   connection_configs -> ERROR: permission denied for every client role

-- staff ----------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"role":"staff"}}',
  false);
set role authenticated;
select 'staff' as simulated_role,
  (select count(*) from fb_sales_orders)                as class_o_fb_sales_orders,
  (select count(*) from sync_events)                    as class_o_sync_events,
  (select count(*) from hercules_offer_uoms)            as class_p_offer_uoms,
  (select count(*) from supplier_contract_cost_lines)   as class_p_cost_lines,
  (select count(*) from pricing_ingestion_rows)         as class_p_ingestion_rows,
  can_view_contract_pricing()                           as class_c_pricing_fn;
reset role;

-- sales_rep ------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"sales_rep"}}',
  false);
set role authenticated;
select 'sales_rep' as simulated_role,
  (select count(*) from fb_sales_orders)                as class_o_fb_sales_orders,
  (select count(*) from sync_events)                    as class_o_sync_events,
  (select count(*) from hercules_offer_uoms)            as class_p_offer_uoms,
  (select count(*) from supplier_contract_cost_lines)   as class_p_cost_lines,
  (select count(*) from pricing_ingestion_rows)         as class_p_ingestion_rows,
  can_view_contract_pricing()                           as class_c_pricing_fn;
reset role;

-- admin ----------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","app_metadata":{"role":"admin"}}',
  false);
set role authenticated;
select 'admin' as simulated_role,
  (select count(*) from fb_sales_orders)                as class_o_fb_sales_orders,
  (select count(*) from hercules_offer_uoms)            as class_p_offer_uoms,
  (select count(*) from supplier_contract_cost_lines)   as class_p_cost_lines,
  (select count(*) from pricing_ingestion_rows)         as class_p_ingestion_rows,
  can_view_contract_pricing()                           as class_c_pricing_fn;
reset role;

-- sales_rep row-scoping (Phase 4) ---------------------------------------------
-- A rep linked via profiles.fishbowl_user_id / sf_user_id sees only orders
-- whose salesperson alias resolves to them; an unlinked rep sees zero rows.
-- Replace the sub with a real profile id to test the positive path:
--   expected = select count(*) from fb_sales_orders
--              where salesperson = any(<that user's aliases>)
select set_config('request.jwt.claims',
  '{"sub":"<profile-uuid>","role":"authenticated","app_metadata":{"role":"sales_rep"}}',
  false);
set role authenticated;
select 'sales_rep_scoped' as simulated_role,
  current_rep_aliases()                                 as aliases,
  (select count(*) from fb_sales_orders)                as visible_orders,
  (select count(*) from canonical_orders)               as visible_canonical;
reset role;

-- Structural checks (run as postgres) -----------------------------------------
-- 1) Every policy in public must be SELECT-only (writes are service-role only):
select cmd, count(*) as policies
from pg_policies
where schemaname = 'public'
group by cmd;
-- expected: a single row, cmd = SELECT

-- 2) No flat USING (true) read policies may remain (except profiles' own-row):
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and qual = 'true';
-- expected: zero rows

-- 3) connection_configs must have no client grants:
select grantee, privilege_type
from information_schema.role_table_grants
where table_name = 'connection_configs'
  and grantee in ('anon', 'authenticated');
-- expected: zero rows
