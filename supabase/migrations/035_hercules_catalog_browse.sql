-- ============================================================
-- Supplier Catalog browser support (P10 follow-up)
-- 1. Trigram + facet indexes so searching ~750k Hercules catalog
--    items from the dashboard stays fast.
-- 2. Align the P10 ingestion-state tables with the Class P RLS
--    tier (migration 026): their original policies were flat
--    authenticated reads, which the RLS standard disallows.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Search: dashboard queries OR together ILIKE '%term%' across these three.
CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_description_trgm
    ON hercules_catalog_items USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_mpn_trgm
    ON hercules_catalog_items USING gin (manufacturer_part_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_manufacturer_trgm
    ON hercules_catalog_items USING gin (manufacturer_name gin_trgm_ops);

-- Facets and filtered listings.
CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_manufacturer
    ON hercules_catalog_items (manufacturer_name);
CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_category
    ON hercules_catalog_items (category);
-- Stable default ordering for the browse table.
CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_updated_at
    ON hercules_catalog_items (updated_at DESC);

-- Vendor part number lookup from the detail/search views.
CREATE INDEX IF NOT EXISTS idx_hercules_offer_uoms_vpn_trgm
    ON hercules_offer_uoms USING gin (vendor_part_number gin_trgm_ops);

-- Class P alignment (see migration 026): supplier/cost/ingestion data is
-- admin-read only. Drop the flat policies migration 024 shipped.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_ingestion_runs' AND policyname = 'auth read hercules_ingestion_runs'
    ) THEN
        DROP POLICY "auth read hercules_ingestion_runs" ON hercules_ingestion_runs;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_ingestion_rejects' AND policyname = 'auth read hercules_ingestion_rejects'
    ) THEN
        DROP POLICY "auth read hercules_ingestion_rejects" ON hercules_ingestion_rejects;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_sync_state' AND policyname = 'auth read hercules_sync_state'
    ) THEN
        DROP POLICY "auth read hercules_sync_state" ON hercules_sync_state;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_ingestion_runs' AND policyname = 'admin read hercules_ingestion_runs'
    ) THEN
        CREATE POLICY "admin read hercules_ingestion_runs" ON hercules_ingestion_runs FOR SELECT TO authenticated USING (is_admin_up());
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_ingestion_rejects' AND policyname = 'admin read hercules_ingestion_rejects'
    ) THEN
        CREATE POLICY "admin read hercules_ingestion_rejects" ON hercules_ingestion_rejects FOR SELECT TO authenticated USING (is_admin_up());
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_sync_state' AND policyname = 'admin read hercules_sync_state'
    ) THEN
        CREATE POLICY "admin read hercules_sync_state" ON hercules_sync_state FOR SELECT TO authenticated USING (is_admin_up());
    END IF;
END $$;

-- Facet aggregates for the catalog browser. Group-bys are not expressible
-- through the Supabase client, so this is the one sanctioned SQL home for
-- them. Service-role only: the dashboard reads it through admin-gated API
-- routes, and catalog aggregates are Class P data.
CREATE OR REPLACE FUNCTION hercules_catalog_facets()
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'manufacturers', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', manufacturer_name, 'count', n) ORDER BY n DESC), '[]'::jsonb)
      FROM (
        SELECT manufacturer_name, count(*) AS n
        FROM hercules_catalog_items
        WHERE manufacturer_name IS NOT NULL
        GROUP BY 1 ORDER BY n DESC LIMIT 50
      ) m
    ),
    'categories', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('name', category, 'count', n) ORDER BY n DESC), '[]'::jsonb)
      FROM (
        SELECT category, count(*) AS n
        FROM hercules_catalog_items
        WHERE category IS NOT NULL
        GROUP BY 1 ORDER BY n DESC LIMIT 50
      ) c
    ),
    'itemsWithOffers', (SELECT count(DISTINCT hercules_catalog_item_id) FROM hercules_vendor_offers),
    'vendorOffers', (SELECT count(*) FROM hercules_vendor_offers),
    'suppliers', (SELECT count(*) FROM hercules_suppliers)
  )
$$;

REVOKE ALL ON FUNCTION hercules_catalog_facets() FROM PUBLIC;
REVOKE ALL ON FUNCTION hercules_catalog_facets() FROM anon;
REVOKE ALL ON FUNCTION hercules_catalog_facets() FROM authenticated;
