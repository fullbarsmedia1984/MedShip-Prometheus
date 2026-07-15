-- ============================================================
-- Supplier Cost Item Matching (Contract Pricing Phase B)
-- Links buy-side supplier_contract_cost_lines to canonical item
-- identity: the internal item spine (pricing_products, seeded from
-- the Fishbowl part master) and the Hercules supplier catalog.
-- All matching is deterministic and suggest-only; a human approves
-- every link. Customer sell-pricing tables are not touched.
-- ============================================================

-- Shared identifier normalization: uppercase, strip non-alphanumerics.
CREATE OR REPLACE FUNCTION pricing_normalize_identifier(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT NULLIF(upper(regexp_replace(coalesce(value, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

-- Canonical item linkage on cost lines.
ALTER TABLE supplier_contract_cost_lines
    ADD COLUMN IF NOT EXISTS hercules_catalog_item_id UUID
        REFERENCES hercules_catalog_items(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'supplier_contract_cost_lines_internal_item_fk'
    ) THEN
        ALTER TABLE supplier_contract_cost_lines
            ADD CONSTRAINT supplier_contract_cost_lines_internal_item_fk
            FOREIGN KEY (internal_item_id) REFERENCES pricing_products(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_contract_cost_lines_internal_item
    ON supplier_contract_cost_lines(internal_item_id);
CREATE INDEX IF NOT EXISTS idx_supplier_contract_cost_lines_hercules_item
    ON supplier_contract_cost_lines(hercules_catalog_item_id);

-- Match suggestion workflow objects.
CREATE TABLE IF NOT EXISTS supplier_cost_line_item_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cost_line_id UUID NOT NULL REFERENCES supplier_contract_cost_lines(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('pricing_product', 'hercules_catalog_item')),
    pricing_product_id UUID REFERENCES pricing_products(id) ON DELETE CASCADE,
    hercules_catalog_item_id UUID REFERENCES hercules_catalog_items(id) ON DELETE CASCADE,
    match_method TEXT NOT NULL
        CHECK (match_method IN ('gtin_exact', 'sku_exact', 'mpn_exact', 'model_exact', 'manual')),
    match_confidence NUMERIC CHECK (match_confidence IS NULL OR (match_confidence >= 0 AND match_confidence <= 1)),
    matched_identifier_field TEXT,
    status TEXT NOT NULL DEFAULT 'suggested'
        CHECK (status IN ('suggested', 'approved', 'rejected', 'superseded')),
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (target_type = 'pricing_product' AND pricing_product_id IS NOT NULL AND hercules_catalog_item_id IS NULL)
        OR (target_type = 'hercules_catalog_item' AND hercules_catalog_item_id IS NOT NULL AND pricing_product_id IS NULL)
    ),
    UNIQUE NULLS NOT DISTINCT (cost_line_id, target_type, pricing_product_id, hercules_catalog_item_id, match_method)
);

CREATE INDEX IF NOT EXISTS idx_supplier_cost_line_item_matches_line
    ON supplier_cost_line_item_matches(cost_line_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_cost_line_item_matches_status
    ON supplier_cost_line_item_matches(status);

ALTER TABLE supplier_cost_line_item_matches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'supplier_cost_line_item_matches'
          AND policyname = 'admin read supplier_cost_line_item_matches'
    ) THEN
        CREATE POLICY "admin read supplier_cost_line_item_matches"
            ON supplier_cost_line_item_matches FOR SELECT TO authenticated
            USING (is_admin_up());
    END IF;
END $$;

-- Expression indexes so normalized-identifier joins stay fast at
-- Hercules-catalog scale (~750k items / ~1.2M offer UOMs).
CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_norm_mpn
    ON hercules_catalog_items (pricing_normalize_identifier(manufacturer_part_number));
CREATE INDEX IF NOT EXISTS idx_hercules_offer_uoms_norm_gtin
    ON hercules_offer_uoms (pricing_normalize_identifier(gtin));
CREATE INDEX IF NOT EXISTS idx_hercules_offer_uoms_norm_vendor_part
    ON hercules_offer_uoms (pricing_normalize_identifier(vendor_part_number));
CREATE INDEX IF NOT EXISTS idx_item_dims_catalog_norm_gtin
    ON item_dims_catalog (pricing_normalize_identifier(gtin));
CREATE INDEX IF NOT EXISTS idx_pricing_products_normalized_sku
    ON pricing_products (normalized_sku);

-- ------------------------------------------------------------
-- Item spine sync: seed/refresh pricing_products + product_crosswalk
-- from the Fishbowl part master cached in inventory_snapshot.
-- Idempotent: upserts by product_key, never deletes.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pricing_sync_products_from_inventory()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    products_inserted INT := 0;
    products_updated INT := 0;
    crosswalk_inserted INT := 0;
BEGIN
    WITH parts AS (
        SELECT DISTINCT ON (part_number)
            part_number,
            part_description,
            uom
        FROM inventory_snapshot
        WHERE part_number IS NOT NULL AND btrim(part_number) <> ''
        ORDER BY part_number, last_synced_at DESC NULLS LAST
    ),
    upserted AS (
        INSERT INTO pricing_products (product_key, zeus_product_id, external_sku, normalized_sku, name, default_uom, is_active)
        SELECT
            'fishbowl:' || parts.part_number,
            parts.part_number,
            parts.part_number,
            pricing_normalize_identifier(parts.part_number),
            coalesce(NULLIF(btrim(parts.part_description), ''), parts.part_number),
            coalesce(NULLIF(btrim(parts.uom), ''), 'Each'),
            true
        FROM parts
        ON CONFLICT (product_key) DO UPDATE SET
            name = EXCLUDED.name,
            default_uom = EXCLUDED.default_uom,
            normalized_sku = EXCLUDED.normalized_sku,
            updated_at = now()
        RETURNING (xmax = 0) AS inserted
    )
    SELECT
        count(*) FILTER (WHERE inserted),
        count(*) FILTER (WHERE NOT inserted)
    INTO products_inserted, products_updated
    FROM upserted;

    WITH missing AS (
        SELECT p.id AS pricing_product_id, p.zeus_product_id AS part_number, p.normalized_sku
        FROM pricing_products p
        WHERE p.product_key LIKE 'fishbowl:%'
          AND NOT EXISTS (
              SELECT 1 FROM product_crosswalk c
              WHERE c.pricing_product_id = p.id
                AND c.source_system = 'fishbowl'
                AND c.fishbowl_part_number = p.zeus_product_id
          )
    ),
    inserted AS (
        INSERT INTO product_crosswalk (
            pricing_product_id, source_system, source_record_id, source_sku,
            normalized_sku, fishbowl_part_number, zeus_product_id,
            match_method, match_status, confidence, is_primary
        )
        SELECT
            missing.pricing_product_id, 'fishbowl', missing.part_number, missing.part_number,
            missing.normalized_sku, missing.part_number, missing.part_number,
            'import', 'matched', 1.0, true
        FROM missing
        RETURNING 1
    )
    SELECT count(*) INTO crosswalk_inserted FROM inserted;

    RETURN jsonb_build_object(
        'products_inserted', products_inserted,
        'products_updated', products_updated,
        'crosswalk_inserted', crosswalk_inserted
    );
END;
$$;

-- ------------------------------------------------------------
-- Deterministic suggest-only item matching for one ingestion batch.
-- Inserts 'suggested' rows into supplier_cost_line_item_matches;
-- never sets internal_item_id / hercules_catalog_item_id itself.
-- Rejected suggestions are not re-inserted (unique constraint).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pricing_suggest_cost_line_item_matches(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    internal_gtin INT := 0;
    internal_sku INT := 0;
    internal_mpn INT := 0;
    internal_model INT := 0;
    hercules_gtin INT := 0;
    hercules_sku INT := 0;
    hercules_mpn INT := 0;
    hercules_model INT := 0;
BEGIN
    -- Cost lines of this batch still lacking an internal item link.
    CREATE TEMP TABLE tmp_unmatched_lines ON COMMIT DROP AS
    SELECT
        l.id,
        l.internal_item_id,
        l.hercules_catalog_item_id,
        pricing_normalize_identifier(l.gtin) AS norm_gtin,
        pricing_normalize_identifier(l.distributor_sku) AS norm_sku,
        pricing_normalize_identifier(l.manufacturer_part_number) AS norm_mpn,
        pricing_normalize_identifier(l.model_number) AS norm_model
    FROM supplier_contract_cost_lines l
    WHERE l.source_batch_id = p_batch_id;

    -- Internal spine: GTIN via item dims -> fishbowl part -> crosswalk.
    WITH ins AS (
        INSERT INTO supplier_cost_line_item_matches
            (cost_line_id, target_type, pricing_product_id, match_method, match_confidence, matched_identifier_field)
        SELECT DISTINCT u.id, 'pricing_product', c.pricing_product_id, 'gtin_exact', 0.98, 'gtin'
        FROM tmp_unmatched_lines u
        JOIN item_dims_catalog d ON pricing_normalize_identifier(d.gtin) = u.norm_gtin
        JOIN product_crosswalk c
          ON c.source_system = 'fishbowl' AND c.fishbowl_part_number = d.fishbowl_part_number
        WHERE u.norm_gtin IS NOT NULL AND u.internal_item_id IS NULL AND c.pricing_product_id IS NOT NULL
        ON CONFLICT DO NOTHING
        RETURNING 1
    ) SELECT count(*) INTO internal_gtin FROM ins;

    -- Internal spine: identifier vs normalized Fishbowl part number.
    WITH ins AS (
        INSERT INTO supplier_cost_line_item_matches
            (cost_line_id, target_type, pricing_product_id, match_method, match_confidence, matched_identifier_field)
        SELECT DISTINCT u.id, 'pricing_product', p.id, 'sku_exact', 0.95, 'distributor_sku'
        FROM tmp_unmatched_lines u
        JOIN pricing_products p ON p.normalized_sku = u.norm_sku
        WHERE u.norm_sku IS NOT NULL AND u.internal_item_id IS NULL
        ON CONFLICT DO NOTHING
        RETURNING 1
    ) SELECT count(*) INTO internal_sku FROM ins;

    WITH ins AS (
        INSERT INTO supplier_cost_line_item_matches
            (cost_line_id, target_type, pricing_product_id, match_method, match_confidence, matched_identifier_field)
        SELECT DISTINCT u.id, 'pricing_product', p.id, 'mpn_exact', 0.90, 'manufacturer_part_number'
        FROM tmp_unmatched_lines u
        JOIN pricing_products p ON p.normalized_sku = u.norm_mpn
        WHERE u.norm_mpn IS NOT NULL AND u.internal_item_id IS NULL
        ON CONFLICT DO NOTHING
        RETURNING 1
    ) SELECT count(*) INTO internal_mpn FROM ins;

    WITH ins AS (
        INSERT INTO supplier_cost_line_item_matches
            (cost_line_id, target_type, pricing_product_id, match_method, match_confidence, matched_identifier_field)
        SELECT DISTINCT u.id, 'pricing_product', p.id, 'model_exact', 0.85, 'model_number'
        FROM tmp_unmatched_lines u
        JOIN pricing_products p ON p.normalized_sku = u.norm_model
        WHERE u.norm_model IS NOT NULL AND u.internal_item_id IS NULL
        ON CONFLICT DO NOTHING
        RETURNING 1
    ) SELECT count(*) INTO internal_model FROM ins;

    -- Hercules catalog: GTIN via offer UOMs.
    WITH ins AS (
        INSERT INTO supplier_cost_line_item_matches
            (cost_line_id, target_type, hercules_catalog_item_id, match_method, match_confidence, matched_identifier_field)
        SELECT DISTINCT u.id, 'hercules_catalog_item', o.hercules_catalog_item_id, 'gtin_exact', 0.95, 'gtin'
        FROM tmp_unmatched_lines u
        JOIN hercules_offer_uoms ou ON pricing_normalize_identifier(ou.gtin) = u.norm_gtin
        JOIN hercules_vendor_offers o ON o.id = ou.hercules_vendor_offer_id
        WHERE u.norm_gtin IS NOT NULL AND u.hercules_catalog_item_id IS NULL
          AND o.hercules_catalog_item_id IS NOT NULL
        ON CONFLICT DO NOTHING
        RETURNING 1
    ) SELECT count(*) INTO hercules_gtin FROM ins;

    -- Hercules catalog: distributor SKU vs vendor part number.
    WITH ins AS (
        INSERT INTO supplier_cost_line_item_matches
            (cost_line_id, target_type, hercules_catalog_item_id, match_method, match_confidence, matched_identifier_field)
        SELECT DISTINCT u.id, 'hercules_catalog_item', o.hercules_catalog_item_id, 'sku_exact', 0.90, 'distributor_sku'
        FROM tmp_unmatched_lines u
        JOIN hercules_offer_uoms ou ON pricing_normalize_identifier(ou.vendor_part_number) = u.norm_sku
        JOIN hercules_vendor_offers o ON o.id = ou.hercules_vendor_offer_id
        WHERE u.norm_sku IS NOT NULL AND u.hercules_catalog_item_id IS NULL
          AND o.hercules_catalog_item_id IS NOT NULL
        ON CONFLICT DO NOTHING
        RETURNING 1
    ) SELECT count(*) INTO hercules_sku FROM ins;

    -- Hercules catalog: MPN / model vs manufacturer part number.
    WITH ins AS (
        INSERT INTO supplier_cost_line_item_matches
            (cost_line_id, target_type, hercules_catalog_item_id, match_method, match_confidence, matched_identifier_field)
        SELECT DISTINCT u.id, 'hercules_catalog_item', h.id, 'mpn_exact', 0.90, 'manufacturer_part_number'
        FROM tmp_unmatched_lines u
        JOIN hercules_catalog_items h
          ON pricing_normalize_identifier(h.manufacturer_part_number) = u.norm_mpn
        WHERE u.norm_mpn IS NOT NULL AND u.hercules_catalog_item_id IS NULL
        ON CONFLICT DO NOTHING
        RETURNING 1
    ) SELECT count(*) INTO hercules_mpn FROM ins;

    WITH ins AS (
        INSERT INTO supplier_cost_line_item_matches
            (cost_line_id, target_type, hercules_catalog_item_id, match_method, match_confidence, matched_identifier_field)
        SELECT DISTINCT u.id, 'hercules_catalog_item', h.id, 'model_exact', 0.85, 'model_number'
        FROM tmp_unmatched_lines u
        JOIN hercules_catalog_items h
          ON pricing_normalize_identifier(h.manufacturer_part_number) = u.norm_model
        WHERE u.norm_model IS NOT NULL AND u.hercules_catalog_item_id IS NULL
        ON CONFLICT DO NOTHING
        RETURNING 1
    ) SELECT count(*) INTO hercules_model FROM ins;

    DROP TABLE IF EXISTS tmp_unmatched_lines;

    RETURN jsonb_build_object(
        'internal_gtin', internal_gtin,
        'internal_sku', internal_sku,
        'internal_mpn', internal_mpn,
        'internal_model', internal_model,
        'hercules_gtin', hercules_gtin,
        'hercules_sku', hercules_sku,
        'hercules_mpn', hercules_mpn,
        'hercules_model', hercules_model,
        'total_suggestions',
            internal_gtin + internal_sku + internal_mpn + internal_model
            + hercules_gtin + hercules_sku + hercules_mpn + hercules_model
    );
END;
$$;

-- Service-role only: these run via the admin client, never from browsers.
REVOKE EXECUTE ON FUNCTION pricing_sync_products_from_inventory() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pricing_sync_products_from_inventory() FROM anon;
REVOKE EXECUTE ON FUNCTION pricing_sync_products_from_inventory() FROM authenticated;
REVOKE EXECUTE ON FUNCTION pricing_suggest_cost_line_item_matches(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pricing_suggest_cost_line_item_matches(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION pricing_suggest_cost_line_item_matches(UUID) FROM authenticated;
