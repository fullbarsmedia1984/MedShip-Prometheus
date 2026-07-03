-- Phase 2 RLS overhaul (PRD §8).
-- Replaces the flat "any authenticated user can read everything" policies
-- with role-tiered policies driven by the JWT app_metadata.role claim.
-- The app reads through the service-role client and is unaffected; these
-- policies govern direct PostgREST access with the public anon key.
--
-- Tiers (PRD §7.1):
--   Class S  connection_configs           -> service role only (migration 024)
--   Class P  cost / supplier / ingestion  -> superadmin, admin
--   Class C  contract sell pricing        -> staff+; reps via revocable
--                                            profiles.can_view_contract_price
--   Class O  operations & cached data     -> staff+ (rep row-scoping lands in
--                                            Phase 4)
-- No table has client write policies: all writes go through the service role.

-- Role helpers ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION jwt_app_role()
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT auth.jwt() -> 'app_metadata' ->> 'role'
$$;

CREATE OR REPLACE FUNCTION is_admin_up()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.jwt_app_role() IN ('superadmin', 'admin')
$$;

CREATE OR REPLACE FUNCTION is_staff_up()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.jwt_app_role() IN ('superadmin', 'admin', 'staff')
$$;

-- Staff and above always see contract pricing; reps only while their
-- profile flag is on (decision 5 -- revoked once COGS/pricing automation
-- is complete). The profiles subquery runs as the caller, whose own-row
-- read policy permits it.
CREATE OR REPLACE FUNCTION can_view_contract_pricing()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT public.is_staff_up()
      OR (
        public.jwt_app_role() IN ('sales_rep', 'sales_manager')
        AND COALESCE(
          (SELECT can_view_contract_price FROM public.profiles
           WHERE id = (SELECT auth.uid())),
          false
        )
      )
$$;

-- Clean slate: drop every existing policy on public tables except profiles
-- (whose policies were purpose-built in migration 025). This also removes the
-- open "manage" write policies on field_mappings, reorder_rules, and
-- app_settings.
DO $$
DECLARE p RECORD;
BEGIN
    FOR p IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename <> 'profiles'
    LOOP
        EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    END LOOP;
END $$;

-- Class P: buy-side cost, supplier, and raw ingestion data -------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'product_cogs',
        'cost_snapshots',
        'hercules_import_jobs',
        'hercules_suppliers',
        'hercules_catalog_items',
        'hercules_vendor_offers',
        'hercules_offer_uoms',
        'hercules_api_sync_states',
        'zeus_product_supplier_mappings',
        'supplier_contracts',
        'supplier_contract_cost_lines',
        'pricing_ingestion_batches',
        'pricing_ingestion_rows',
        'pricing_ingestion_exceptions',
        'pricing_publish_events',
        'pricing_import_batches',
        'pricing_rules',
        'pricing_guardrail_events'
    ]
    LOOP
        -- Skip tables that do not exist yet (023's estimator tables merge
        -- from a parallel worktree; fresh rebuilds may order differently).
        CONTINUE WHEN to_regclass('public.' || t) IS NULL;
        EXECUTE format(
            'CREATE POLICY "admin read %s" ON %I FOR SELECT TO authenticated USING (is_admin_up())',
            t, t
        );
    END LOOP;
END $$;

-- Class C: contract sell pricing ----------------------------------------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'customer_contracts',
        'contract_price_lines',
        'pricing_calculation_snapshots'
    ]
    LOOP
        CONTINUE WHEN to_regclass('public.' || t) IS NULL;
        EXECUTE format(
            'CREATE POLICY "pricing read %s" ON %I FOR SELECT TO authenticated USING (can_view_contract_pricing())',
            t, t
        );
    END LOOP;
END $$;

-- Class O: operations, cached SF/Fishbowl data, product identity --------------
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'sync_events',
        'sync_schedules',
        'inventory_snapshot',
        'field_mappings',
        'reorder_rules',
        'app_settings',
        'sf_users',
        'sf_accounts',
        'sf_products',
        'sf_opportunities',
        'sf_opportunity_line_items',
        'sf_profile_calls',
        'sf_call_activities',
        'sf_sync_state',
        'fb_sales_orders',
        'fb_sales_order_items',
        'opportunity_sales_order_links',
        'fishbowl_so_sync_runs',
        'fishbowl_so_page_checkpoints',
        'fishbowl_so_detail_queue',
        'fishbowl_salesperson_aliases',
        'pricing_products',
        'product_crosswalk',
        'pricing_quality_results',
        'estimates',
        'estimator_llm_calls',
        'item_dims_verified',
        'packing_rules',
        'standard_boxes'
    ]
    LOOP
        CONTINUE WHEN to_regclass('public.' || t) IS NULL;
        EXECUTE format(
            'CREATE POLICY "staff read %s" ON %I FOR SELECT TO authenticated USING (is_staff_up())',
            t, t
        );
    END LOOP;
END $$;

-- connection_configs (class S) intentionally gets no policy: migration 024
-- revoked all client access; only the service role touches it.
