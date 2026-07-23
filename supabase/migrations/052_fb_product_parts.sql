-- Fishbowl product -> part mapping cache (P15).
-- Sales-order lines are keyed by PRODUCT number (the selling SKU, e.g.
-- "130306cs"), while inventory_snapshot and fb_open_po_lines are keyed by
-- PART number (the stocked SKU, e.g. "2C8537"). Joining demand to stock or
-- to open POs is meaningless without this bridge: only ~3% of product
-- numbers coincide with their part number. `factor` converts one product
-- unit into part units (e.g. cs48 -> 48 ea) via Fishbowl's uomconversion.
CREATE TABLE fb_product_parts (
  product_num text PRIMARY KEY,
  part_num text NOT NULL,
  factor numeric NOT NULL DEFAULT 1,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fb_product_parts_part_idx ON fb_product_parts (part_num);

ALTER TABLE fb_product_parts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read fb_product_parts" ON fb_product_parts
  FOR SELECT TO authenticated USING (is_staff_up());
