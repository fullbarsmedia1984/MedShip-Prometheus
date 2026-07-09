-- ============================================================
-- Join indexes for the Hercules dims matching spine.
-- The item_dims_catalog backfill (scripts/backfill-item-dims-
-- catalog.sql) and any future re-run join catalog items ->
-- vendor offers -> offer UOMs for a few thousand matched parts;
-- without these FK indexes each pass seq-scans 0.8M/1.2M rows.
-- (hercules_catalog_items(manufacturer_part_number) is also a
-- natural candidate but is deferred: concurrent index builds on
-- that table are in flight and would serialize behind them.)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_hercules_vendor_offers_catalog_item
  ON hercules_vendor_offers(hercules_catalog_item_id);

CREATE INDEX IF NOT EXISTS idx_hercules_offer_uoms_vendor_offer
  ON hercules_offer_uoms(hercules_vendor_offer_id);

CREATE INDEX IF NOT EXISTS idx_hercules_offer_uoms_vendor_part_number
  ON hercules_offer_uoms(vendor_part_number)
  WHERE vendor_part_number IS NOT NULL;
