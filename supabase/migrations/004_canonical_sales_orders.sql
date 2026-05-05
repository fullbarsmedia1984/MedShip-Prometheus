-- ============================================================
-- Canonical Fishbowl Sales Order Model
-- Fishbowl Sales Orders are the operational source of truth for
-- quote/order line items. Salesforce Opportunities remain pipeline.
-- ============================================================

CREATE TABLE IF NOT EXISTS fb_sales_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fishbowl_id TEXT,
    so_number TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    customer_name TEXT,
    customer_id TEXT,
    customer_po TEXT,
    salesperson TEXT,
    date_created TIMESTAMPTZ,
    date_scheduled DATE,
    date_issued TIMESTAMPTZ,
    date_completed TIMESTAMPTZ,
    total_amount DECIMAL(14,2),
    subtotal_amount DECIMAL(14,2),
    tax_amount DECIMAL(14,2),
    shipping_amount DECIMAL(14,2),
    currency TEXT DEFAULT 'USD',
    ship_to_name TEXT,
    ship_to_street TEXT,
    ship_to_city TEXT,
    ship_to_state TEXT,
    ship_to_postal_code TEXT,
    ship_to_country TEXT,
    sf_opportunity_id TEXT,
    sf_quote_id TEXT,
    sf_order_id TEXT,
    quote_status TEXT,
    canonical_state TEXT NOT NULL DEFAULT 'quote'
        CHECK (canonical_state IN ('quote', 'order', 'void', 'unknown')),
    raw_data JSONB,
    first_synced_at TIMESTAMPTZ DEFAULT now(),
    last_synced_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fb_sales_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_number TEXT NOT NULL REFERENCES fb_sales_orders(so_number) ON DELETE CASCADE,
    fishbowl_line_id TEXT,
    line_number INT,
    part_number TEXT,
    part_description TEXT,
    sf_product_id TEXT,
    quantity DECIMAL(12,2) DEFAULT 0,
    quantity_fulfilled DECIMAL(12,2),
    quantity_uom TEXT,
    unit_price DECIMAL(12,2),
    total_price DECIMAL(14,2),
    raw_data JSONB,
    last_synced_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (sales_order_number, line_number),
    UNIQUE (sales_order_number, fishbowl_line_id)
);

CREATE TABLE IF NOT EXISTS opportunity_sales_order_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sf_opportunity_id TEXT NOT NULL,
    so_number TEXT NOT NULL REFERENCES fb_sales_orders(so_number) ON DELETE CASCADE,
    sf_quote_id TEXT,
    sf_order_id TEXT,
    relationship_source TEXT NOT NULL DEFAULT 'prometheus',
    confidence TEXT NOT NULL DEFAULT 'explicit'
        CHECK (confidence IN ('explicit', 'high', 'medium', 'low')),
    is_primary BOOLEAN DEFAULT true,
    raw_match_data JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (sf_opportunity_id, so_number)
);

CREATE INDEX IF NOT EXISTS idx_fb_so_status ON fb_sales_orders(status);
CREATE INDEX IF NOT EXISTS idx_fb_so_canonical_state ON fb_sales_orders(canonical_state);
CREATE INDEX IF NOT EXISTS idx_fb_so_opportunity ON fb_sales_orders(sf_opportunity_id);
CREATE INDEX IF NOT EXISTS idx_fb_so_quote ON fb_sales_orders(sf_quote_id);
CREATE INDEX IF NOT EXISTS idx_fb_so_order ON fb_sales_orders(sf_order_id);
CREATE INDEX IF NOT EXISTS idx_fb_so_synced ON fb_sales_orders(last_synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_fb_so_items_so ON fb_sales_order_items(sales_order_number);
CREATE INDEX IF NOT EXISTS idx_fb_so_items_part ON fb_sales_order_items(part_number);
CREATE INDEX IF NOT EXISTS idx_opp_so_links_opp ON opportunity_sales_order_links(sf_opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opp_so_links_so ON opportunity_sales_order_links(so_number);

CREATE OR REPLACE VIEW canonical_quotes AS
SELECT *
FROM fb_sales_orders
WHERE canonical_state = 'quote';

CREATE OR REPLACE VIEW canonical_orders AS
SELECT *
FROM fb_sales_orders
WHERE canonical_state = 'order';

INSERT INTO sync_schedules (automation, cron_expression, is_active, records_processed)
VALUES ('P7_FB_SO_SYNC', '*/15 * * * *', true, 0)
ON CONFLICT (automation) DO NOTHING;

INSERT INTO sf_sync_state (table_name) VALUES
    ('fb_sales_orders'),
    ('fb_sales_order_items'),
    ('opportunity_sales_order_links')
ON CONFLICT (table_name) DO NOTHING;

ALTER TABLE fb_sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunity_sales_order_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read fb_sales_orders" ON fb_sales_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read fb_sales_order_items" ON fb_sales_order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read opportunity_sales_order_links" ON opportunity_sales_order_links FOR SELECT TO authenticated USING (true);
