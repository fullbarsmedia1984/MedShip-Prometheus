-- ============================================================
-- Hercules API unit metadata
-- Preserve egress unit fields from /api/v1/parts/list.
-- ============================================================

ALTER TABLE hercules_offer_uoms
    ADD COLUMN IF NOT EXISTS raw_per_text TEXT,
    ADD COLUMN IF NOT EXISTS parsed_per_quantity NUMERIC(14,4),
    ADD COLUMN IF NOT EXISTS parsed_per_uom TEXT,
    ADD COLUMN IF NOT EXISTS is_default BOOLEAN,
    ADD COLUMN IF NOT EXISTS quantity_available NUMERIC(14,4),
    ADD COLUMN IF NOT EXISTS volume_uom TEXT;

CREATE INDEX IF NOT EXISTS idx_hercules_offer_uoms_default
    ON hercules_offer_uoms(is_default)
    WHERE is_default IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hercules_offer_uoms_parsed_per_uom
    ON hercules_offer_uoms(parsed_per_uom)
    WHERE parsed_per_uom IS NOT NULL;
