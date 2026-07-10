-- Rolling cache of recent Fishbowl shipments (ship table, statusId 30 =
-- Shipped, last 10 days). Drives the wallboard's "Shipped" lane: a shipment
-- going out the door counts even while the SO is still In Progress
-- (partial shipments) or before the cached SO status/date_completed flips.
CREATE TABLE fb_recent_shipments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ship_number text NOT NULL,
  so_number text NOT NULL,
  status_id int NOT NULL,
  date_shipped timestamptz NOT NULL,
  carton_count int,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fb_recent_shipments_so_idx ON fb_recent_shipments (so_number);
CREATE INDEX fb_recent_shipments_date_idx ON fb_recent_shipments (date_shipped DESC);

ALTER TABLE fb_recent_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read fb_recent_shipments" ON fb_recent_shipments
  FOR SELECT TO authenticated USING (is_staff_up());
