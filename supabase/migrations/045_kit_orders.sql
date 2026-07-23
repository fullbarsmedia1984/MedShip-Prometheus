-- P13 Kit Assembly module (Phase 1).
-- Zeus becomes the canonical system for nursing-kit assembly (Fishbowl's
-- BOM/MO modules are unused). kit_orders is a per--KIT-SO ops overlay that
-- holds what only humans know — the school's need-by dates, transit days,
-- rep, staging table, workflow checkoffs — replacing the SharePoint
-- "Nursing Kit Report" workbook. Everything computable (kit counts, pick
-- progress, backorders, ship dates, turn time, on-time) derives live from
-- the fb_* caches and is NOT stored here.
CREATE TABLE kit_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  so_number text NOT NULL UNIQUE,
  earliest_need_by date,
  absolute_need_by date,
  transit_days int CHECK (transit_days IS NULL OR transit_days BETWEEN 0 AND 30),
  rep text,                       -- rep initials, e.g. 'SE', 'LJ'
  table_location text,            -- physical staging table, e.g. '12B'
  kit_list_printed boolean NOT NULL DEFAULT false,
  sub_kit_status text CHECK (sub_kit_status IN ('received', 'pack_as_needed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);
CREATE INDEX kit_orders_so_idx ON kit_orders (so_number);

-- Class O: staff-tier read (incl. warehouse via app tier), service-role writes.
ALTER TABLE kit_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read kit_orders" ON kit_orders
  FOR SELECT TO authenticated USING (is_staff_up());
