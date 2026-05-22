-- ============================================================
-- Hercules Contract Pricing / COGS Ingestion Scaffold
-- Supplier offer + UOM-level cost model for Zeus consumption.
-- ============================================================

CREATE TABLE IF NOT EXISTS hercules_import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_system TEXT NOT NULL DEFAULT 'hercules',
    source_mode TEXT NOT NULL DEFAULT 'fixture'
        CHECK (source_mode IN ('fixture', 'api', 'csv', 'json', 'direct_db', 'webhook')),
    supplier_code TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('success', 'failed', 'partial', 'running')),
    rows_seen INT NOT NULL DEFAULT 0,
    rows_inserted INT NOT NULL DEFAULT 0,
    rows_updated INT NOT NULL DEFAULT 0,
    rows_rejected INT NOT NULL DEFAULT 0,
    numeric_contract_price_count INT NOT NULL DEFAULT 0,
    request_quote_price_count INT NOT NULL DEFAULT 0,
    list_only_price_count INT NOT NULL DEFAULT 0,
    missing_uom_count INT NOT NULL DEFAULT 0,
    missing_vendor_part_number_count INT NOT NULL DEFAULT 0,
    errors_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hercules_suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key TEXT NOT NULL UNIQUE,
    source_payload_hash TEXT NOT NULL,
    hercules_supplier_id TEXT UNIQUE,
    supplier_code TEXT UNIQUE,
    supplier_name TEXT NOT NULL,
    is_vendor BOOLEAN NOT NULL DEFAULT false,
    is_manufacturer BOOLEAN NOT NULL DEFAULT false,
    is_direct BOOLEAN NOT NULL DEFAULT false,
    status TEXT,
    address TEXT,
    hercules_created_at TIMESTAMPTZ,
    hercules_updated_at TIMESTAMPTZ,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_seen_import_job_id UUID REFERENCES hercules_import_jobs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hercules_catalog_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key TEXT NOT NULL UNIQUE,
    source_payload_hash TEXT NOT NULL,
    hercules_item_id TEXT NOT NULL UNIQUE,
    ms_id TEXT,
    description TEXT,
    brand TEXT,
    manufacturer_hercules_id TEXT,
    manufacturer_name TEXT,
    manufacturer_part_number TEXT,
    category TEXT,
    subcategory TEXT,
    unspsc TEXT,
    country_of_origin TEXT,
    status TEXT,
    image_urls_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_seen_import_job_id UUID REFERENCES hercules_import_jobs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hercules_vendor_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key TEXT NOT NULL UNIQUE,
    source_payload_hash TEXT NOT NULL,
    hercules_catalog_item_id UUID NOT NULL REFERENCES hercules_catalog_items(id) ON DELETE CASCADE,
    hercules_item_id TEXT NOT NULL,
    supplier_id UUID NOT NULL REFERENCES hercules_suppliers(id) ON DELETE RESTRICT,
    supplier_code TEXT,
    vendor_name TEXT NOT NULL,
    vendor_product_title TEXT NOT NULL DEFAULT '',
    is_primary BOOLEAN NOT NULL DEFAULT false,
    lead_time TEXT,
    minimum_order_quantity NUMERIC(14,4),
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_seen_import_job_id UUID REFERENCES hercules_import_jobs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (hercules_catalog_item_id, supplier_id, vendor_product_title)
);

CREATE TABLE IF NOT EXISTS hercules_offer_uoms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key TEXT NOT NULL UNIQUE,
    source_payload_hash TEXT NOT NULL,
    hercules_vendor_offer_id UUID NOT NULL REFERENCES hercules_vendor_offers(id) ON DELETE CASCADE,
    uom_code TEXT,
    vendor_part_number TEXT,
    uom_title TEXT,
    package TEXT,
    per_quantity NUMERIC(14,4),
    list_price_amount NUMERIC(14,4),
    contract_price_amount NUMERIC(14,4),
    contract_price_status TEXT NOT NULL
        CHECK (contract_price_status IN (
            'contract_available',
            'list_only_request_quote',
            'list_only',
            'not_provided',
            'unavailable',
            'expired',
            'parse_error',
            'unknown'
        )),
    raw_contract_price_text TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    weight NUMERIC(14,4),
    weight_unit TEXT,
    length NUMERIC(14,4),
    width NUMERIC(14,4),
    height NUMERIC(14,4),
    dimension_unit TEXT,
    gtin TEXT,
    hcpcs TEXT,
    volume TEXT,
    availability TEXT,
    is_cost_eligible BOOLEAN NOT NULL DEFAULT false,
    cost_ineligibility_reason TEXT,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_seen_import_job_id UUID REFERENCES hercules_import_jobs(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (
        hercules_vendor_offer_id,
        uom_code,
        vendor_part_number,
        package,
        per_quantity
    )
);

CREATE TABLE IF NOT EXISTS zeus_product_supplier_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zeus_product_id TEXT NOT NULL,
    hercules_catalog_item_id UUID NOT NULL REFERENCES hercules_catalog_items(id) ON DELETE CASCADE,
    hercules_vendor_offer_id UUID NOT NULL REFERENCES hercules_vendor_offers(id) ON DELETE CASCADE,
    hercules_offer_uom_id UUID NOT NULL REFERENCES hercules_offer_uoms(id) ON DELETE CASCADE,
    match_method TEXT NOT NULL DEFAULT 'manual'
        CHECK (match_method IN (
            'manual',
            'exact_ms_id',
            'exact_mpn',
            'exact_vpn',
            'exact_gtin',
            'exact_ndc',
            'imported_mapping',
            'fuzzy_description'
        )),
    match_confidence NUMERIC(5,2),
    approval_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (approval_status IN ('pending', 'approved', 'rejected', 'needs_review')),
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    rejected_by TEXT,
    rejected_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (zeus_product_id, hercules_offer_uom_id)
);

CREATE TABLE IF NOT EXISTS cost_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zeus_product_id TEXT NOT NULL,
    quote_id TEXT,
    order_id TEXT,
    line_id TEXT,
    supplier_id UUID REFERENCES hercules_suppliers(id) ON DELETE SET NULL,
    hercules_catalog_item_id UUID REFERENCES hercules_catalog_items(id) ON DELETE SET NULL,
    hercules_vendor_offer_id UUID REFERENCES hercules_vendor_offers(id) ON DELETE SET NULL,
    hercules_offer_uom_id UUID REFERENCES hercules_offer_uoms(id) ON DELETE SET NULL,
    unit_cost_used NUMERIC(14,4) NOT NULL CHECK (unit_cost_used >= 0),
    extended_cost_used NUMERIC(14,4) CHECK (extended_cost_used IS NULL OR extended_cost_used >= 0),
    quantity NUMERIC(14,4),
    uom_code TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    cost_source TEXT NOT NULL DEFAULT 'hercules',
    contract_price_status TEXT,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hercules_import_jobs_started ON hercules_import_jobs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_hercules_import_jobs_supplier ON hercules_import_jobs(supplier_code);

CREATE INDEX IF NOT EXISTS idx_hercules_suppliers_code ON hercules_suppliers(supplier_code);

CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_ms_id ON hercules_catalog_items(ms_id);
CREATE INDEX IF NOT EXISTS idx_hercules_catalog_items_mpn ON hercules_catalog_items(manufacturer_part_number);

CREATE INDEX IF NOT EXISTS idx_hercules_vendor_offers_item ON hercules_vendor_offers(hercules_catalog_item_id);
CREATE INDEX IF NOT EXISTS idx_hercules_vendor_offers_supplier ON hercules_vendor_offers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_hercules_vendor_offers_supplier_code ON hercules_vendor_offers(supplier_code);

CREATE INDEX IF NOT EXISTS idx_hercules_offer_uoms_offer ON hercules_offer_uoms(hercules_vendor_offer_id);
CREATE INDEX IF NOT EXISTS idx_hercules_offer_uoms_vpn ON hercules_offer_uoms(vendor_part_number);
CREATE INDEX IF NOT EXISTS idx_hercules_offer_uoms_status ON hercules_offer_uoms(contract_price_status);
CREATE INDEX IF NOT EXISTS idx_hercules_offer_uoms_cost_eligible ON hercules_offer_uoms(is_cost_eligible);
CREATE INDEX IF NOT EXISTS idx_hercules_offer_uoms_eligible ON hercules_offer_uoms(is_cost_eligible, contract_price_status);
CREATE INDEX IF NOT EXISTS idx_hercules_offer_uoms_gtin ON hercules_offer_uoms(gtin);

CREATE INDEX IF NOT EXISTS idx_zeus_product_supplier_mappings_zeus ON zeus_product_supplier_mappings(zeus_product_id);
CREATE INDEX IF NOT EXISTS idx_zeus_product_supplier_mappings_approval ON zeus_product_supplier_mappings(approval_status);
CREATE INDEX IF NOT EXISTS idx_zeus_product_supplier_mappings_zeus_approval
    ON zeus_product_supplier_mappings(zeus_product_id, approval_status);

CREATE INDEX IF NOT EXISTS idx_cost_snapshots_zeus_product ON cost_snapshots(zeus_product_id);
CREATE INDEX IF NOT EXISTS idx_cost_snapshots_quote_line ON cost_snapshots(quote_id, line_id);
CREATE INDEX IF NOT EXISTS idx_cost_snapshots_order_line ON cost_snapshots(order_id, line_id);

ALTER TABLE hercules_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hercules_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE hercules_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE hercules_vendor_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE hercules_offer_uoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE zeus_product_supplier_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_import_jobs' AND policyname = 'auth read hercules_import_jobs'
    ) THEN
        CREATE POLICY "auth read hercules_import_jobs" ON hercules_import_jobs FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_suppliers' AND policyname = 'auth read hercules_suppliers'
    ) THEN
        CREATE POLICY "auth read hercules_suppliers" ON hercules_suppliers FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_catalog_items' AND policyname = 'auth read hercules_catalog_items'
    ) THEN
        CREATE POLICY "auth read hercules_catalog_items" ON hercules_catalog_items FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_vendor_offers' AND policyname = 'auth read hercules_vendor_offers'
    ) THEN
        CREATE POLICY "auth read hercules_vendor_offers" ON hercules_vendor_offers FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_offer_uoms' AND policyname = 'auth read hercules_offer_uoms'
    ) THEN
        CREATE POLICY "auth read hercules_offer_uoms" ON hercules_offer_uoms FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'zeus_product_supplier_mappings' AND policyname = 'auth read zeus_product_supplier_mappings'
    ) THEN
        CREATE POLICY "auth read zeus_product_supplier_mappings" ON zeus_product_supplier_mappings FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'cost_snapshots' AND policyname = 'auth read cost_snapshots'
    ) THEN
        CREATE POLICY "auth read cost_snapshots" ON cost_snapshots FOR SELECT TO authenticated USING (true);
    END IF;
END $$;
