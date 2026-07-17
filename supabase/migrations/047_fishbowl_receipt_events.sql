-- P14: immutable Fishbowl receipt-item facts for the warehouse Receiving view.
--
-- The existing PO cache stores only each PO line's latest fulfillment date.
-- That is useful as a rollout fallback, but cannot preserve split deliveries
-- or reconstruct a prior day's receiving activity. Receipt items are upserted
-- by their Fishbowl identity so every partial delivery remains queryable.
CREATE TABLE public.fb_receipt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fishbowl_receipt_item_id integer NOT NULL UNIQUE,
  fishbowl_receipt_id integer NOT NULL,
  fishbowl_po_id integer NOT NULL,
  po_number text NOT NULL,
  vendor_id integer,
  vendor_name text,
  fishbowl_po_line_id integer NOT NULL,
  po_line_number integer,
  part_id integer,
  part_number text,
  qty_received numeric NOT NULL,
  date_received timestamptz NOT NULL,
  receipt_status_id integer,
  receipt_status text,
  receipt_item_status_id integer,
  receipt_item_status text,
  tracking_number text,
  source_last_modified timestamptz,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_synced_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fb_receipt_events_received_idx
  ON public.fb_receipt_events (date_received DESC);
CREATE INDEX fb_receipt_events_po_idx
  ON public.fb_receipt_events (fishbowl_po_id, date_received DESC);
CREATE INDEX fb_receipt_events_part_idx
  ON public.fb_receipt_events (part_number, date_received DESC)
  WHERE part_number IS NOT NULL;
CREATE INDEX fb_receipt_events_modified_idx
  ON public.fb_receipt_events (source_last_modified DESC)
  WHERE source_last_modified IS NOT NULL;

-- This table is internal operational data. The wallboard reads it only from
-- server-side code using the service role; browser roles have no table grant.
ALTER TABLE public.fb_receipt_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.fb_receipt_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.fb_receipt_events TO service_role;

-- Standard sync audit/freshness row. The job writes the existing sync_events
-- log and updates this row after each completed run.
INSERT INTO public.sync_schedules (
  automation,
  cron_expression,
  is_active,
  records_processed
)
VALUES (
  'P14_RECEIPTS_SYNC',
  'TZ=America/Chicago 11,26,41,56 6-18 * * 1-5',
  true,
  0
)
ON CONFLICT (automation) DO UPDATE
SET cron_expression = EXCLUDED.cron_expression;
