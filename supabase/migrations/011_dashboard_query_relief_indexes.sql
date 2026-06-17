-- Dashboard query relief for large Fishbowl Sales Order backfills.
-- These indexes support page-scoped Orders/Quotes reads and event-log filtering.

CREATE INDEX IF NOT EXISTS idx_fb_so_state_issued
  ON fb_sales_orders(canonical_state, date_issued DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_fb_so_state_created
  ON fb_sales_orders(canonical_state, date_created DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_fb_so_salesperson
  ON fb_sales_orders(salesperson);

CREATE INDEX IF NOT EXISTS idx_fb_so_items_so_line
  ON fb_sales_order_items(sales_order_number, line_number);

CREATE INDEX IF NOT EXISTS idx_sync_events_automation_created
  ON sync_events(automation, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_events_status_created
  ON sync_events(status, created_at DESC);

