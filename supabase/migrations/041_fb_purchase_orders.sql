-- Durable Fishbowl purchase-order cache (P11). Foundation for upcoming
-- purchasing functionality in Zeus; synced incrementally by dateLastModified
-- on a business-hours cron (8a/10a/12p/2p/4p Mon-Fri America/Chicago).
CREATE TABLE fb_purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fishbowl_id integer NOT NULL UNIQUE,
  po_number text NOT NULL,
  status_id integer,
  type_id integer,
  vendor_id integer,
  vendor_name text,
  buyer text,
  vendor_so text,
  customer_so text,
  note text,
  date_created timestamptz,
  date_issued timestamptz,
  date_completed timestamptz,
  date_first_ship timestamptz,
  date_last_modified timestamptz,
  raw_data jsonb,
  first_synced_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fb_purchase_orders_status_idx ON fb_purchase_orders (status_id);
CREATE INDEX fb_purchase_orders_modified_idx ON fb_purchase_orders (date_last_modified DESC);
CREATE INDEX fb_purchase_orders_number_idx ON fb_purchase_orders (po_number);

CREATE TABLE fb_purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fishbowl_line_id integer NOT NULL UNIQUE,
  fishbowl_po_id integer NOT NULL,
  po_number text NOT NULL,
  line_number integer,
  part_number text,
  vendor_part_number text,
  description text,
  type_id integer,
  status_id integer,
  qty_to_fulfill numeric,
  qty_fulfilled numeric,
  qty_picked numeric,
  unit_cost numeric,
  total_cost numeric,
  date_scheduled timestamptz,
  date_last_fulfillment timestamptz,
  raw_data jsonb,
  last_synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fb_po_items_po_idx ON fb_purchase_order_items (fishbowl_po_id);
CREATE INDEX fb_po_items_part_idx ON fb_purchase_order_items (part_number);

-- Class P data (supplier costs) — admin read only, service-role writes.
ALTER TABLE fb_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE fb_purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read fb_purchase_orders" ON fb_purchase_orders
  FOR SELECT TO authenticated USING (is_admin_up());
CREATE POLICY "admin read fb_purchase_order_items" ON fb_purchase_order_items
  FOR SELECT TO authenticated USING (is_admin_up());
