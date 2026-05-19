-- Disable placeholder automations that were creating noisy production failures.
-- These workflows remain visible in Zeus as Coming Soon, but should not run on
-- an Inngest cron until their upstream integrations and mappings are complete.

update sync_schedules
set
  cron_expression = '',
  is_active = false,
  last_run_status = 'coming_soon',
  next_run_at = null
where automation in (
  'P3_QB_INVOICE_SYNC',
  'P4_SHIPMENT_TRACKING',
  'P6_LOW_STOCK_CHECK'
);
