-- Reconciled from live DB (Phase 0, PRD §12): applied 2026-07-01 as version
-- 20260701173407 "020_contract_pricing_migration_layer" via MCP apply_migration,
-- but never committed to the repo. Recorded verbatim for repo/schema parity.
-- Do NOT re-apply to the production project.

-- ============================================================
-- Contract Pricing Migration Layer
-- Stages reviewed supplier/distributor contract-cost dry runs.
-- These tables are buy-side supplier cost data, not customer sell pricing.
-- ============================================================

CREATE TABLE IF NOT EXISTS pricing_ingestion_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file_name TEXT,
    source_file_hash TEXT,
    dry_run_id TEXT,
    profile_name TEXT NOT NULL,
    profile_version TEXT NOT NULL,
    distributor_name TEXT,
    distributor_id UUID,
    supplier_contract_id UUID,
    manifest_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    decision_application_id TEXT,
    status TEXT NOT NULL DEFAULT 'staged'
        CHECK (status IN ('staged', 'needs_review', 'approved', 'publishing', 'published', 'rejected', 'rolled_back')),
    row_count INT NOT NULL DEFAULT 0,
    valid_row_count INT NOT NULL DEFAULT 0,
    warning_row_count INT NOT NULL DEFAULT 0,
    blocking_row_count INT NOT NULL DEFAULT 0,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    rejected_by UUID,
    rejected_at TIMESTAMPTZ,
    published_by UUID,
    published_at TIMESTAMPTZ,
    rollback_of_batch_id UUID REFERENCES pricing_ingestion_batches(id) ON DELETE SET NULL,
    summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE NULLS NOT DISTINCT (source_file_hash, dry_run_id, profile_name, profile_version)
);

CREATE TABLE IF NOT EXISTS pricing_ingestion_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES pricing_ingestion_batches(id) ON DELETE CASCADE,
    row_number INT,
    ingestion_row_id TEXT,
    validation_status TEXT
        CHECK (validation_status IS NULL OR validation_status IN ('valid', 'warning', 'blocking')),
    exception_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    warning_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    canonical_row JSONB NOT NULL,
    raw_row_reference JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_file_name TEXT,
    source_file_hash TEXT,
    source_sheet_name TEXT,
    source_row_number INT,
    source_column_map JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_cell_map JSONB NOT NULL DEFAULT '{}'::jsonb,
    formula_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pricing_ingestion_exceptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES pricing_ingestion_batches(id) ON DELETE CASCADE,
    row_id UUID REFERENCES pricing_ingestion_rows(id) ON DELETE SET NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'blocking')),
    exception_code TEXT NOT NULL,
    canonical_field TEXT,
    source_sheet_name TEXT,
    source_row_number INT,
    source_cell_reference TEXT,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'acknowledged', 'resolved', 'waived', 'rejected')),
    assigned_to UUID,
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    resolution TEXT,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_name TEXT NOT NULL,
    supplier_id UUID,
    contract_name TEXT,
    contract_number TEXT,
    account_number TEXT,
    location_scope TEXT,
    effective_date DATE,
    expiration_date DATE,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'expired', 'superseded', 'archived')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (expiration_date IS NULL OR effective_date IS NULL OR expiration_date >= effective_date)
);

ALTER TABLE pricing_ingestion_batches
    ADD CONSTRAINT pricing_ingestion_batches_supplier_contract_fk
    FOREIGN KEY (supplier_contract_id) REFERENCES supplier_contracts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS supplier_contract_cost_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_contract_id UUID REFERENCES supplier_contracts(id) ON DELETE SET NULL,
    supplier_name TEXT,
    supplier_id UUID,
    internal_item_id UUID,
    distributor_sku TEXT,
    manufacturer_name TEXT,
    manufacturer_part_number TEXT,
    model_number TEXT,
    gtin TEXT,
    udi TEXT,
    ndc TEXT,
    item_description_raw TEXT,
    item_description_normalized TEXT,
    raw_price NUMERIC NOT NULL CHECK (raw_price >= 0),
    cost NUMERIC NOT NULL CHECK (cost >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    raw_price_uom TEXT,
    normalized_price_uom TEXT,
    raw_base_uom TEXT,
    normalized_base_uom TEXT,
    raw_uom TEXT,
    normalized_uom TEXT,
    raw_pack_size TEXT,
    pack_size NUMERIC,
    tier TEXT,
    minimum_quantity NUMERIC,
    effective_date DATE,
    expiration_date DATE,
    source_batch_id UUID REFERENCES pricing_ingestion_batches(id) ON DELETE SET NULL,
    source_row_id UUID REFERENCES pricing_ingestion_rows(id) ON DELETE SET NULL,
    source_file_name TEXT,
    source_file_hash TEXT,
    source_sheet_name TEXT,
    source_row_number INT,
    source_column_map JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_cell_map JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT false,
    approval_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (approval_status IN ('pending', 'approved', 'rejected', 'superseded', 'rolled_back')),
    supersedes_cost_line_id UUID REFERENCES supplier_contract_cost_lines(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    approved_at TIMESTAMPTZ,
    approved_by UUID,
    CHECK (expiration_date IS NULL OR effective_date IS NULL OR expiration_date >= effective_date)
);

CREATE TABLE IF NOT EXISTS pricing_publish_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID REFERENCES pricing_ingestion_batches(id) ON DELETE SET NULL,
    action TEXT NOT NULL
        CHECK (action IN ('approve_batch', 'publish_batch', 'rollback_batch', 'reject_batch')),
    actor_id UUID,
    status TEXT NOT NULL,
    summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_pricing_ingestion_batches_status
    ON pricing_ingestion_batches(status);
CREATE INDEX IF NOT EXISTS idx_pricing_ingestion_batches_profile
    ON pricing_ingestion_batches(profile_name, profile_version);
CREATE INDEX IF NOT EXISTS idx_pricing_ingestion_batches_source_hash
    ON pricing_ingestion_batches(source_file_hash);

CREATE INDEX IF NOT EXISTS idx_pricing_ingestion_rows_batch
    ON pricing_ingestion_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_pricing_ingestion_rows_validation
    ON pricing_ingestion_rows(validation_status);

CREATE INDEX IF NOT EXISTS idx_pricing_ingestion_exceptions_batch_status
    ON pricing_ingestion_exceptions(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_pricing_ingestion_exceptions_code
    ON pricing_ingestion_exceptions(exception_code);

CREATE INDEX IF NOT EXISTS idx_supplier_contracts_supplier_name
    ON supplier_contracts(supplier_name);
CREATE INDEX IF NOT EXISTS idx_supplier_contracts_contract_number
    ON supplier_contracts(contract_number);
CREATE INDEX IF NOT EXISTS idx_supplier_contracts_status
    ON supplier_contracts(status);

CREATE INDEX IF NOT EXISTS idx_supplier_contract_cost_lines_contract
    ON supplier_contract_cost_lines(supplier_contract_id);
CREATE INDEX IF NOT EXISTS idx_supplier_contract_cost_lines_supplier_name
    ON supplier_contract_cost_lines(supplier_name);
CREATE INDEX IF NOT EXISTS idx_supplier_contract_cost_lines_distributor_sku
    ON supplier_contract_cost_lines(distributor_sku);
CREATE INDEX IF NOT EXISTS idx_supplier_contract_cost_lines_mpn
    ON supplier_contract_cost_lines(manufacturer_part_number);
CREATE INDEX IF NOT EXISTS idx_supplier_contract_cost_lines_model
    ON supplier_contract_cost_lines(model_number);
CREATE INDEX IF NOT EXISTS idx_supplier_contract_cost_lines_active
    ON supplier_contract_cost_lines(active);
CREATE INDEX IF NOT EXISTS idx_supplier_contract_cost_lines_approval
    ON supplier_contract_cost_lines(approval_status);
CREATE INDEX IF NOT EXISTS idx_supplier_contract_cost_lines_effective
    ON supplier_contract_cost_lines(effective_date, expiration_date);

CREATE INDEX IF NOT EXISTS idx_pricing_publish_events_batch
    ON pricing_publish_events(batch_id);

ALTER TABLE pricing_ingestion_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_ingestion_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_ingestion_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_contract_cost_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_publish_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'pricing_ingestion_batches' AND policyname = 'auth read pricing_ingestion_batches'
    ) THEN
        CREATE POLICY "auth read pricing_ingestion_batches" ON pricing_ingestion_batches FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'pricing_ingestion_rows' AND policyname = 'auth read pricing_ingestion_rows'
    ) THEN
        CREATE POLICY "auth read pricing_ingestion_rows" ON pricing_ingestion_rows FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'pricing_ingestion_exceptions' AND policyname = 'auth read pricing_ingestion_exceptions'
    ) THEN
        CREATE POLICY "auth read pricing_ingestion_exceptions" ON pricing_ingestion_exceptions FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'supplier_contracts' AND policyname = 'auth read supplier_contracts'
    ) THEN
        CREATE POLICY "auth read supplier_contracts" ON supplier_contracts FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'supplier_contract_cost_lines' AND policyname = 'auth read supplier_contract_cost_lines'
    ) THEN
        CREATE POLICY "auth read supplier_contract_cost_lines" ON supplier_contract_cost_lines FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'pricing_publish_events' AND policyname = 'auth read pricing_publish_events'
    ) THEN
        CREATE POLICY "auth read pricing_publish_events" ON pricing_publish_events FOR SELECT TO authenticated USING (true);
    END IF;
END $$;
