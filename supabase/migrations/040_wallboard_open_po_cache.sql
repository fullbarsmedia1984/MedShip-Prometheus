-- Cache of open Fishbowl purchase-order lines for the warehouse wallboard.
-- Refreshed server-side (data-query API) when older than ~15 minutes; the
-- board answers "is short stock on order, and when does it land?" from here.
CREATE TABLE fb_open_po_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_number text NOT NULL,
  status_id int NOT NULL,          -- Fishbowl PO status (20 Issued, 40 Partial)
  part_number text NOT NULL,
  qty_open numeric NOT NULL,       -- qtyToFulfill - qtyFulfilled
  expected_date date,              -- poitem.dateScheduledFulfillment
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fb_open_po_lines_part_idx ON fb_open_po_lines (part_number);

ALTER TABLE fb_open_po_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read fb_open_po_lines" ON fb_open_po_lines
  FOR SELECT TO authenticated USING (is_staff_up());
