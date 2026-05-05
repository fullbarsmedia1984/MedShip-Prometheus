-- ============================================================
-- Zeus Pricing Architecture
-- Canonical product identity, contract pricing, COGS history,
-- pricing rules, quality gates, and guardrail audit records.
-- ============================================================

CREATE TABLE IF NOT EXISTS pricing_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_type TEXT NOT NULL
        CHECK (import_type IN ('pricing_products', 'product_crosswalk', 'contract_prices', 'product_cogs', 'pricing_rules', 'mixed')),
    source_system TEXT NOT NULL DEFAULT 'manual',
    source_file_name TEXT,
    storage_path TEXT,
    file_hash TEXT,
    status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded', 'validating', 'validated', 'committing', 'committed', 'rejected', 'failed')),
    total_rows INT DEFAULT 0,
    valid_rows INT DEFAULT 0,
    rejected_rows INT DEFAULT 0,
    committed_rows INT DEFAULT 0,
    validation_errors JSONB,
    raw_metadata JSONB,
    created_by TEXT,
    committed_by TEXT,
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pricing_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_key TEXT NOT NULL UNIQUE,
    zeus_product_id TEXT UNIQUE,
    external_sku TEXT,
    normalized_sku TEXT,
    name TEXT NOT NULL,
    description TEXT,
    product_family TEXT,
    default_uom TEXT DEFAULT 'Each',
    manufacturer TEXT,
    brand TEXT,
    is_active BOOLEAN DEFAULT true,
    source_batch_id UUID REFERENCES pricing_import_batches(id) ON DELETE SET NULL,
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_crosswalk (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pricing_product_id UUID REFERENCES pricing_products(id) ON DELETE SET NULL,
    source_system TEXT NOT NULL
        CHECK (source_system IN ('salesforce', 'fishbowl', 'zeus', 'manual', 'import', 'other')),
    source_record_id TEXT,
    source_sku TEXT,
    source_name TEXT,
    normalized_sku TEXT,
    sf_product_id TEXT,
    fishbowl_part_number TEXT,
    zeus_product_id TEXT,
    match_method TEXT NOT NULL DEFAULT 'needs_review'
        CHECK (match_method IN ('explicit_manual', 'salesforce_product_id', 'normalized_sku_exact', 'zeus_product_id', 'import', 'needs_review')),
    match_status TEXT NOT NULL DEFAULT 'needs_review'
        CHECK (match_status IN ('matched', 'needs_review', 'conflict', 'ignored', 'inactive')),
    confidence DECIMAL(5,2),
    is_primary BOOLEAN DEFAULT false,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    source_batch_id UUID REFERENCES pricing_import_batches(id) ON DELETE SET NULL,
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_number TEXT NOT NULL UNIQUE,
    contract_name TEXT,
    customer_account_sf_id TEXT,
    customer_account_name TEXT,
    customer_external_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'expired', 'terminated', 'archived')),
    currency TEXT DEFAULT 'USD',
    effective_start DATE NOT NULL,
    effective_end DATE,
    source_system TEXT NOT NULL DEFAULT 'manual',
    source_batch_id UUID REFERENCES pricing_import_batches(id) ON DELETE SET NULL,
    notes TEXT,
    raw_data JSONB,
    created_by TEXT,
    updated_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CHECK (effective_end IS NULL OR effective_end >= effective_start)
);

CREATE TABLE IF NOT EXISTS contract_price_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID NOT NULL REFERENCES customer_contracts(id) ON DELETE CASCADE,
    pricing_product_id UUID NOT NULL REFERENCES pricing_products(id) ON DELETE RESTRICT,
    line_number INT,
    contract_sku TEXT,
    uom TEXT DEFAULT 'Each',
    currency TEXT DEFAULT 'USD',
    unit_price DECIMAL(14,4) NOT NULL CHECK (unit_price >= 0),
    contract_cost DECIMAL(14,4) CHECK (contract_cost IS NULL OR contract_cost >= 0),
    quantity_min DECIMAL(12,2) DEFAULT 1 CHECK (quantity_min >= 0),
    quantity_max DECIMAL(12,2),
    effective_start DATE NOT NULL,
    effective_end DATE,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'superseded', 'archived')),
    source_batch_id UUID REFERENCES pricing_import_batches(id) ON DELETE SET NULL,
    source_row_number INT,
    raw_data JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (contract_id, pricing_product_id, uom, quantity_min, effective_start),
    CHECK (quantity_max IS NULL OR quantity_max >= quantity_min),
    CHECK (effective_end IS NULL OR effective_end >= effective_start)
);

CREATE TABLE IF NOT EXISTS product_cogs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pricing_product_id UUID NOT NULL REFERENCES pricing_products(id) ON DELETE RESTRICT,
    cost_source TEXT NOT NULL
        CHECK (cost_source IN ('contract', 'vendor_purchase', 'fishbowl_standard', 'fishbowl_average', 'manual', 'import', 'other')),
    source_system TEXT NOT NULL DEFAULT 'manual',
    source_record_id TEXT,
    vendor_name TEXT,
    uom TEXT DEFAULT 'Each',
    currency TEXT DEFAULT 'USD',
    unit_cost DECIMAL(14,4) NOT NULL CHECK (unit_cost >= 0),
    landed_cost DECIMAL(14,4) CHECK (landed_cost IS NULL OR landed_cost >= 0),
    freight_cost DECIMAL(14,4) CHECK (freight_cost IS NULL OR freight_cost >= 0),
    effective_start DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_end DATE,
    is_current BOOLEAN DEFAULT true,
    source_batch_id UUID REFERENCES pricing_import_batches(id) ON DELETE SET NULL,
    raw_data JSONB,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CHECK (effective_end IS NULL OR effective_end >= effective_start)
);

CREATE TABLE IF NOT EXISTS pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_key TEXT NOT NULL UNIQUE,
    rule_name TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global'
        CHECK (scope IN ('global', 'product_family', 'product', 'customer_contract', 'account')),
    scope_value TEXT,
    target_margin_pct DECIMAL(5,4) NOT NULL DEFAULT 0.3000
        CHECK (target_margin_pct >= 0 AND target_margin_pct < 1),
    minimum_margin_pct DECIMAL(5,4) NOT NULL DEFAULT 0.2000
        CHECK (minimum_margin_pct >= 0 AND minimum_margin_pct < 1),
    allow_below_floor BOOLEAN DEFAULT false,
    requires_approval_below_floor BOOLEAN DEFAULT true,
    missing_cogs_behavior TEXT NOT NULL DEFAULT 'warn'
        CHECK (missing_cogs_behavior IN ('warn', 'block', 'ignore')),
    missing_contract_behavior TEXT NOT NULL DEFAULT 'block'
        CHECK (missing_contract_behavior IN ('warn', 'block', 'ignore')),
    currency TEXT DEFAULT 'USD',
    priority INT DEFAULT 100,
    is_active BOOLEAN DEFAULT true,
    version INT DEFAULT 1,
    effective_start DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_end DATE,
    metadata JSONB,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    CHECK (minimum_margin_pct <= target_margin_pct),
    CHECK (effective_end IS NULL OR effective_end >= effective_start)
);

CREATE TABLE IF NOT EXISTS pricing_quality_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL DEFAULT gen_random_uuid(),
    quality_gate TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warn'
        CHECK (severity IN ('info', 'warn', 'error', 'blocker')),
    entity_type TEXT NOT NULL,
    entity_record_id TEXT,
    pricing_product_id UUID REFERENCES pricing_products(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'fail'
        CHECK (status IN ('pass', 'fail', 'warn', 'skipped')),
    message TEXT,
    details JSONB,
    source_batch_id UUID REFERENCES pricing_import_batches(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS pricing_calculation_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    calculation_key TEXT UNIQUE,
    calculated_at TIMESTAMPTZ DEFAULT now(),
    pricing_product_id UUID REFERENCES pricing_products(id) ON DELETE SET NULL,
    customer_contract_id UUID REFERENCES customer_contracts(id) ON DELETE SET NULL,
    contract_price_line_id UUID REFERENCES contract_price_lines(id) ON DELETE SET NULL,
    pricing_rule_id UUID REFERENCES pricing_rules(id) ON DELETE SET NULL,
    source_line_system TEXT
        CHECK (source_line_system IS NULL OR source_line_system IN ('salesforce_opp_line', 'salesforce_quote_line', 'fishbowl_so_line', 'manual', 'api', 'other')),
    source_line_id TEXT,
    customer_account_sf_id TEXT,
    quantity DECIMAL(12,2),
    uom TEXT DEFAULT 'Each',
    currency TEXT DEFAULT 'USD',
    contract_price DECIMAL(14,4),
    cost_basis DECIMAL(14,4),
    quoted_unit_price DECIMAL(14,4),
    suggested_retail_price DECIMAL(14,4),
    minimum_quote_price DECIMAL(14,4),
    gross_margin_dollars DECIMAL(14,4),
    gross_margin_pct DECIMAL(8,6),
    below_floor BOOLEAN,
    missing_data JSONB,
    rule_version INT,
    inputs JSONB,
    result JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pricing_guardrail_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id UUID REFERENCES pricing_calculation_snapshots(id) ON DELETE SET NULL,
    pricing_product_id UUID REFERENCES pricing_products(id) ON DELETE SET NULL,
    source_system TEXT NOT NULL DEFAULT 'zeus'
        CHECK (source_system IN ('salesforce', 'fishbowl', 'zeus', 'api', 'other')),
    source_record_id TEXT,
    source_line_id TEXT,
    event_type TEXT NOT NULL
        CHECK (event_type IN ('below_floor', 'missing_cogs', 'missing_contract_price', 'expired_contract', 'currency_mismatch', 'overlapping_price_lines', 'manual_override', 'approval_required', 'blocked', 'warning')),
    severity TEXT NOT NULL DEFAULT 'warn'
        CHECK (severity IN ('info', 'warn', 'error', 'blocker')),
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'acknowledged', 'approved', 'rejected', 'resolved', 'ignored')),
    quoted_unit_price DECIMAL(14,4),
    minimum_quote_price DECIMAL(14,4),
    margin_gap DECIMAL(14,4),
    message TEXT,
    exception_reason TEXT,
    requested_by TEXT,
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_import_batches_type ON pricing_import_batches(import_type);
CREATE INDEX IF NOT EXISTS idx_pricing_import_batches_status ON pricing_import_batches(status);
CREATE INDEX IF NOT EXISTS idx_pricing_import_batches_created ON pricing_import_batches(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pricing_products_key ON pricing_products(product_key);
CREATE INDEX IF NOT EXISTS idx_pricing_products_zeus_id ON pricing_products(zeus_product_id);
CREATE INDEX IF NOT EXISTS idx_pricing_products_external_sku ON pricing_products(external_sku);
CREATE INDEX IF NOT EXISTS idx_pricing_products_normalized_sku ON pricing_products(normalized_sku);
CREATE INDEX IF NOT EXISTS idx_pricing_products_active ON pricing_products(is_active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_crosswalk_source_record
    ON product_crosswalk(source_system, source_record_id)
    WHERE source_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_crosswalk_product ON product_crosswalk(pricing_product_id);
CREATE INDEX IF NOT EXISTS idx_product_crosswalk_source_sku ON product_crosswalk(source_system, source_sku);
CREATE INDEX IF NOT EXISTS idx_product_crosswalk_normalized_sku ON product_crosswalk(normalized_sku);
CREATE INDEX IF NOT EXISTS idx_product_crosswalk_sf_product ON product_crosswalk(sf_product_id);
CREATE INDEX IF NOT EXISTS idx_product_crosswalk_fishbowl_part ON product_crosswalk(fishbowl_part_number);
CREATE INDEX IF NOT EXISTS idx_product_crosswalk_status ON product_crosswalk(match_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_crosswalk_primary_source
    ON product_crosswalk(pricing_product_id, source_system)
    WHERE is_primary = true AND pricing_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_contracts_account ON customer_contracts(customer_account_sf_id);
CREATE INDEX IF NOT EXISTS idx_customer_contracts_status ON customer_contracts(status);
CREATE INDEX IF NOT EXISTS idx_customer_contracts_effective ON customer_contracts(effective_start, effective_end);
CREATE INDEX IF NOT EXISTS idx_customer_contracts_batch ON customer_contracts(source_batch_id);

CREATE INDEX IF NOT EXISTS idx_contract_price_lines_contract ON contract_price_lines(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_price_lines_product ON contract_price_lines(pricing_product_id);
CREATE INDEX IF NOT EXISTS idx_contract_price_lines_active_product ON contract_price_lines(pricing_product_id, effective_start, effective_end)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_contract_price_lines_batch ON contract_price_lines(source_batch_id);

CREATE INDEX IF NOT EXISTS idx_product_cogs_product ON product_cogs(pricing_product_id);
CREATE INDEX IF NOT EXISTS idx_product_cogs_current ON product_cogs(pricing_product_id, is_current);
CREATE INDEX IF NOT EXISTS idx_product_cogs_effective ON product_cogs(pricing_product_id, effective_start, effective_end);
CREATE INDEX IF NOT EXISTS idx_product_cogs_batch ON product_cogs(source_batch_id);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_active ON pricing_rules(is_active, priority);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_scope ON pricing_rules(scope, scope_value);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_effective ON pricing_rules(effective_start, effective_end);

CREATE INDEX IF NOT EXISTS idx_pricing_quality_results_run ON pricing_quality_results(run_id);
CREATE INDEX IF NOT EXISTS idx_pricing_quality_results_gate ON pricing_quality_results(quality_gate, status);
CREATE INDEX IF NOT EXISTS idx_pricing_quality_results_product ON pricing_quality_results(pricing_product_id);
CREATE INDEX IF NOT EXISTS idx_pricing_quality_results_created ON pricing_quality_results(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_product ON pricing_calculation_snapshots(pricing_product_id);
CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_contract ON pricing_calculation_snapshots(customer_contract_id);
CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_source_line ON pricing_calculation_snapshots(source_line_system, source_line_id);
CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_calculated ON pricing_calculation_snapshots(calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_below_floor ON pricing_calculation_snapshots(below_floor);

CREATE INDEX IF NOT EXISTS idx_pricing_guardrail_events_status ON pricing_guardrail_events(status, severity);
CREATE INDEX IF NOT EXISTS idx_pricing_guardrail_events_source ON pricing_guardrail_events(source_system, source_record_id, source_line_id);
CREATE INDEX IF NOT EXISTS idx_pricing_guardrail_events_product ON pricing_guardrail_events(pricing_product_id);
CREATE INDEX IF NOT EXISTS idx_pricing_guardrail_events_created ON pricing_guardrail_events(created_at DESC);

INSERT INTO pricing_rules (
    rule_key,
    rule_name,
    scope,
    target_margin_pct,
    minimum_margin_pct,
    missing_cogs_behavior,
    missing_contract_behavior,
    priority
) VALUES (
    'default_global_margin',
    'Default global pricing margin',
    'global',
    0.3000,
    0.2000,
    'warn',
    'block',
    100
)
ON CONFLICT (rule_key) DO NOTHING;

INSERT INTO sync_schedules (automation, cron_expression, is_active, records_processed) VALUES
    ('P8_PRICING_DATA_SYNC', '', true, 0),
    ('P9_PRICING_QUALITY_CHECK', '0 6 * * *', true, 0)
ON CONFLICT (automation) DO NOTHING;

INSERT INTO sf_sync_state (table_name) VALUES
    ('pricing_products'),
    ('product_crosswalk'),
    ('customer_contracts'),
    ('contract_price_lines'),
    ('product_cogs'),
    ('pricing_rules'),
    ('pricing_quality_results'),
    ('pricing_calculation_snapshots'),
    ('pricing_guardrail_events'),
    ('pricing_import_batches')
ON CONFLICT (table_name) DO NOTHING;

ALTER TABLE pricing_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_crosswalk ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_price_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_cogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_quality_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_calculation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_guardrail_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'pricing_import_batches' AND policyname = 'auth read pricing_import_batches'
    ) THEN
        CREATE POLICY "auth read pricing_import_batches" ON pricing_import_batches FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'pricing_products' AND policyname = 'auth read pricing_products'
    ) THEN
        CREATE POLICY "auth read pricing_products" ON pricing_products FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'product_crosswalk' AND policyname = 'auth read product_crosswalk'
    ) THEN
        CREATE POLICY "auth read product_crosswalk" ON product_crosswalk FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'customer_contracts' AND policyname = 'auth read customer_contracts'
    ) THEN
        CREATE POLICY "auth read customer_contracts" ON customer_contracts FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'contract_price_lines' AND policyname = 'auth read contract_price_lines'
    ) THEN
        CREATE POLICY "auth read contract_price_lines" ON contract_price_lines FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'product_cogs' AND policyname = 'auth read product_cogs'
    ) THEN
        CREATE POLICY "auth read product_cogs" ON product_cogs FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'pricing_rules' AND policyname = 'auth read pricing_rules'
    ) THEN
        CREATE POLICY "auth read pricing_rules" ON pricing_rules FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'pricing_quality_results' AND policyname = 'auth read pricing_quality_results'
    ) THEN
        CREATE POLICY "auth read pricing_quality_results" ON pricing_quality_results FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'pricing_calculation_snapshots' AND policyname = 'auth read pricing_calculation_snapshots'
    ) THEN
        CREATE POLICY "auth read pricing_calculation_snapshots" ON pricing_calculation_snapshots FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'pricing_guardrail_events' AND policyname = 'auth read pricing_guardrail_events'
    ) THEN
        CREATE POLICY "auth read pricing_guardrail_events" ON pricing_guardrail_events FOR SELECT TO authenticated USING (true);
    END IF;
END $$;
