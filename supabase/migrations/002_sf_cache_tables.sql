-- ============================================================
-- Salesforce Cache Tables
-- These mirror SF objects and are populated by sync jobs.
-- Updated via upsert on sf_id. Never write to these manually.
-- ============================================================

-- App-level settings (data source mode, feature flags)
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES
    ('data_source_mode', '"seed"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Sales rep users from Salesforce
CREATE TABLE IF NOT EXISTS sf_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sf_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    email TEXT,
    username TEXT,
    is_active BOOLEAN DEFAULT true,
    user_type TEXT,
    profile_name TEXT,
    raw_data JSONB,
    last_synced_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sf_users_active ON sf_users(is_active);

-- Accounts (nursing schools, universities, hospitals)
CREATE TABLE IF NOT EXISTS sf_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sf_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT,
    industry TEXT,
    billing_street TEXT,
    billing_city TEXT,
    billing_state TEXT,
    billing_postal_code TEXT,
    billing_country TEXT,
    shipping_street TEXT,
    shipping_city TEXT,
    shipping_state TEXT,
    shipping_postal_code TEXT,
    shipping_country TEXT,
    phone TEXT,
    website TEXT,
    owner_sf_id TEXT,
    created_date TIMESTAMPTZ,
    last_modified_date TIMESTAMPTZ,
    raw_data JSONB,
    last_synced_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sf_accounts_owner ON sf_accounts(owner_sf_id);
CREATE INDEX idx_sf_accounts_state ON sf_accounts(billing_state);
CREATE INDEX idx_sf_accounts_modified ON sf_accounts(last_modified_date DESC);

-- Products (Product2)
CREATE TABLE IF NOT EXISTS sf_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sf_id TEXT NOT NULL UNIQUE,
    product_code TEXT,
    name TEXT NOT NULL,
    description TEXT,
    family TEXT,
    is_active BOOLEAN DEFAULT true,
    qty_on_hand DECIMAL(10,2),
    qty_available DECIMAL(10,2),
    last_inventory_sync TIMESTAMPTZ,
    raw_data JSONB,
    last_synced_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sf_products_code ON sf_products(product_code);
CREATE INDEX idx_sf_products_active ON sf_products(is_active);

-- Opportunities (pipeline + closed deals)
CREATE TABLE IF NOT EXISTS sf_opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sf_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    account_sf_id TEXT,
    owner_sf_id TEXT,
    stage_name TEXT,
    amount DECIMAL(14,2),
    close_date DATE,
    probability DECIMAL(5,2),
    forecast_category TEXT,
    type TEXT,
    lead_source TEXT,
    is_closed BOOLEAN,
    is_won BOOLEAN,
    fishbowl_so_number TEXT,
    fulfillment_status TEXT,
    fulfillment_error TEXT,
    last_sync_attempt TIMESTAMPTZ,
    created_date TIMESTAMPTZ,
    last_modified_date TIMESTAMPTZ,
    raw_data JSONB,
    last_synced_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sf_opps_owner ON sf_opportunities(owner_sf_id);
CREATE INDEX idx_sf_opps_account ON sf_opportunities(account_sf_id);
CREATE INDEX idx_sf_opps_stage ON sf_opportunities(stage_name);
CREATE INDEX idx_sf_opps_close_date ON sf_opportunities(close_date);
CREATE INDEX idx_sf_opps_closed ON sf_opportunities(is_closed, is_won);
CREATE INDEX idx_sf_opps_modified ON sf_opportunities(last_modified_date DESC);

-- Opportunity line items
CREATE TABLE IF NOT EXISTS sf_opportunity_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sf_id TEXT NOT NULL UNIQUE,
    opportunity_sf_id TEXT NOT NULL,
    product_sf_id TEXT,
    product_code TEXT,
    product_name TEXT,
    quantity DECIMAL(10,2),
    unit_price DECIMAL(12,2),
    total_price DECIMAL(14,2),
    raw_data JSONB,
    last_synced_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sf_oli_opp ON sf_opportunity_line_items(opportunity_sf_id);
CREATE INDEX idx_sf_oli_product ON sf_opportunity_line_items(product_sf_id);

-- Profile calls (from Activity — Task + Event union)
CREATE TABLE IF NOT EXISTS sf_profile_calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sf_id TEXT NOT NULL UNIQUE,
    activity_type TEXT NOT NULL,
    subject TEXT,
    owner_sf_id TEXT,
    account_sf_id TEXT,
    who_sf_id TEXT,
    who_name TEXT,
    activity_date DATE,
    status TEXT,
    profile_call_type TEXT,
    profile_call_outcome TEXT,
    products_discussed TEXT,
    program_size TEXT,
    current_supplier TEXT,
    budget_available DECIMAL(12,2),
    budget_timeframe TEXT,
    follow_up_date DATE,
    converted_to_opp BOOLEAN DEFAULT false,
    related_opportunity_sf_id TEXT,
    call_notes_summary TEXT,
    competitor_intel TEXT,
    ringdna_direction TEXT,
    ringdna_duration_min DECIMAL(6,2),
    ringdna_connected BOOLEAN DEFAULT false,
    ringdna_rating INT,
    ringdna_recording_url TEXT,
    ringdna_voicemail BOOLEAN DEFAULT false,
    ringdna_keywords TEXT,
    ringdna_start_time TIMESTAMPTZ,
    ringdna_disposition TEXT,
    calendly_no_show BOOLEAN DEFAULT false,
    calendly_rescheduled BOOLEAN DEFAULT false,
    created_date TIMESTAMPTZ,
    last_modified_date TIMESTAMPTZ,
    raw_data JSONB,
    last_synced_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sf_calls_owner ON sf_profile_calls(owner_sf_id);
CREATE INDEX idx_sf_calls_account ON sf_profile_calls(account_sf_id);
CREATE INDEX idx_sf_calls_date ON sf_profile_calls(activity_date DESC);
CREATE INDEX idx_sf_calls_modified ON sf_profile_calls(last_modified_date DESC);
CREATE INDEX idx_sf_calls_outcome ON sf_profile_calls(profile_call_outcome);

-- Sync metadata — track per-table sync state
CREATE TABLE IF NOT EXISTS sf_sync_state (
    table_name TEXT PRIMARY KEY,
    last_full_sync_at TIMESTAMPTZ,
    last_incremental_sync_at TIMESTAMPTZ,
    last_sync_high_watermark TIMESTAMPTZ,
    record_count INT DEFAULT 0,
    last_error TEXT,
    last_sync_duration_ms INT
);

INSERT INTO sf_sync_state (table_name) VALUES
    ('sf_users'),
    ('sf_accounts'),
    ('sf_products'),
    ('sf_opportunities'),
    ('sf_opportunity_line_items'),
    ('sf_profile_calls')
ON CONFLICT (table_name) DO NOTHING;

-- RLS
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_opportunity_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_profile_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read app_settings" ON app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth manage app_settings" ON app_settings FOR ALL TO authenticated USING (true);
CREATE POLICY "auth read sf_users" ON sf_users FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read sf_accounts" ON sf_accounts FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read sf_products" ON sf_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read sf_opportunities" ON sf_opportunities FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read sf_oli" ON sf_opportunity_line_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read sf_calls" ON sf_profile_calls FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read sf_sync_state" ON sf_sync_state FOR SELECT TO authenticated USING (true);
