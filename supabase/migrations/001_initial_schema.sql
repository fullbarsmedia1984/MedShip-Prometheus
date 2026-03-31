-- supabase/migrations/001_initial_schema.sql

-- Sync event log — every API call and its result
CREATE TABLE sync_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    automation TEXT NOT NULL,           -- 'P1_OPP_TO_SO', 'P2_INVENTORY_SYNC', etc.
    source_system TEXT NOT NULL,        -- 'salesforce', 'fishbowl', 'quickbooks'
    target_system TEXT NOT NULL,
    source_record_id TEXT,             -- e.g., SF Opportunity ID
    target_record_id TEXT,             -- e.g., Fishbowl SO number
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'success', 'failed', 'retrying'
    payload JSONB,                     -- Request payload sent
    response JSONB,                    -- Response received
    error_message TEXT,
    retry_count INT DEFAULT 0,
    max_retries INT DEFAULT 4,
    next_retry_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    idempotency_key TEXT UNIQUE        -- Prevents duplicate processing
);

CREATE INDEX idx_sync_events_status ON sync_events(status);
CREATE INDEX idx_sync_events_automation ON sync_events(automation);
CREATE INDEX idx_sync_events_created ON sync_events(created_at DESC);
CREATE INDEX idx_sync_events_idempotency ON sync_events(idempotency_key);

-- Inventory snapshot — cached Fishbowl inventory for fast SF lookups
CREATE TABLE inventory_snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part_number TEXT NOT NULL UNIQUE,
    part_description TEXT,
    qty_on_hand DECIMAL(10,2) DEFAULT 0,
    qty_allocated DECIMAL(10,2) DEFAULT 0,
    qty_available DECIMAL(10,2) DEFAULT 0,
    uom TEXT DEFAULT 'Each',
    location TEXT,
    fishbowl_part_id INT,
    last_synced_at TIMESTAMPTZ DEFAULT now(),
    sf_product_id TEXT                  -- Salesforce Product2.Id for reverse lookup
);

CREATE INDEX idx_inventory_part ON inventory_snapshot(part_number);

-- Field mappings — configurable SF ↔ Fishbowl field translations
CREATE TABLE field_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    automation TEXT NOT NULL,           -- Which automation uses this mapping
    source_field TEXT NOT NULL,         -- e.g., 'Account.ShippingStreet'
    target_field TEXT NOT NULL,         -- e.g., 'shipTo.address'
    transform TEXT,                     -- Optional: 'uppercase', 'truncate:50', etc.
    is_required BOOLEAN DEFAULT false,
    default_value TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Reorder rules — per-product stock thresholds
CREATE TABLE reorder_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part_number TEXT NOT NULL UNIQUE,
    part_description TEXT,
    reorder_point DECIMAL(10,2) NOT NULL,    -- Alert when qty_available drops below
    reorder_quantity DECIMAL(10,2) NOT NULL,  -- Suggested PO quantity
    preferred_supplier TEXT,
    is_active BOOLEAN DEFAULT true,
    last_triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Connection configs — API credentials and settings (encrypted at rest by Supabase)
CREATE TABLE connection_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    system_name TEXT NOT NULL UNIQUE,   -- 'salesforce', 'fishbowl', 'quickbooks', 'easypost'
    config JSONB NOT NULL,             -- Connection details (tokens, URLs, etc.)
    is_active BOOLEAN DEFAULT true,
    last_connected_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Sync schedules — track when each cron job last ran
CREATE TABLE sync_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    automation TEXT NOT NULL UNIQUE,
    cron_expression TEXT NOT NULL,       -- e.g., '*/15 * * * *' for every 15 min
    is_active BOOLEAN DEFAULT true,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    last_run_status TEXT,
    last_run_duration_ms INT,
    records_processed INT DEFAULT 0
);

-- Insert default sync schedules
INSERT INTO sync_schedules (automation, cron_expression) VALUES
    ('P2_INVENTORY_SYNC', '*/15 * * * *'),
    ('P3_QB_INVOICE_SYNC', '0 * * * *'),
    ('P4_SHIPMENT_TRACKING', '*/15 * * * *'),
    ('P6_LOW_STOCK_CHECK', '*/15 * * * *');

-- Enable Row Level Security
ALTER TABLE sync_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reorder_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_schedules ENABLE ROW LEVEL SECURITY;

-- Policies: authenticated users can read all, only service role can write
CREATE POLICY "Authenticated users can read sync_events" ON sync_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read inventory" ON inventory_snapshot FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read mappings" ON field_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage mappings" ON field_mappings FOR ALL TO authenticated USING (true);
CREATE POLICY "Authenticated users can read reorder_rules" ON reorder_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can manage reorder_rules" ON reorder_rules FOR ALL TO authenticated USING (true);
CREATE POLICY "Authenticated users can read configs" ON connection_configs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read schedules" ON sync_schedules FOR SELECT TO authenticated USING (true);
