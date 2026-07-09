-- ============================================================
-- Catalog-sourced item dimensions (Zeus Packaging Estimator)
--
-- Middle trust tier between item_dims_verified (human-verified)
-- and live Fishbowl advisory dims. Populated by automated
-- backfill from the Hercules vendor catalog and the Fishbowl
-- product table; never written by end users.
--
-- Weight semantics: the estimator packs with SHIPPING (gross)
-- weight. Vendor catalogs report a single unlabeled pack weight,
-- so gross_weight_lb holds the best available shipping weight
-- and weight_basis records what the source actually labeled it
-- as. net_weight_lb is populated only when the source
-- distinguishes contents-only weight.
-- ============================================================

CREATE TABLE IF NOT EXISTS item_dims_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fishbowl_part_number TEXT NOT NULL,
  -- Pack level the dims describe, normalized ('EA','BX','CS',...).
  -- 'EA' rows feed per-unit packing; case-level rows support case
  -- variant parts (e.g. "10001cs") and full-case shipments.
  uom_code TEXT NOT NULL DEFAULT 'EA',
  length_in NUMERIC NOT NULL CHECK (length_in > 0),
  width_in NUMERIC NOT NULL CHECK (width_in > 0),
  height_in NUMERIC NOT NULL CHECK (height_in > 0),
  gross_weight_lb NUMERIC NOT NULL CHECK (gross_weight_lb > 0),
  net_weight_lb NUMERIC CHECK (net_weight_lb > 0),
  weight_basis TEXT NOT NULL DEFAULT 'unlabeled_assumed_gross'
    CHECK (weight_basis IN ('gross_labeled', 'net_labeled', 'unlabeled_assumed_gross')),
  source_system TEXT NOT NULL CHECK (source_system IN ('hercules', 'fishbowl_product')),
  source_vendor TEXT,
  gtin TEXT,
  hercules_catalog_item_id UUID,
  hercules_offer_uom_id UUID,
  match_method TEXT NOT NULL CHECK (match_method IN (
    'exact_mpn', 'normalized_mpn', 'vendor_part_number', 'gtin', 'fishbowl_product'
  )),
  match_confidence NUMERIC NOT NULL CHECK (match_confidence >= 0 AND match_confidence <= 1),
  backfill_run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT item_dims_catalog_part_uom UNIQUE (fishbowl_part_number, uom_code),
  CONSTRAINT item_dims_catalog_gross_ge_net
    CHECK (net_weight_lb IS NULL OR gross_weight_lb >= net_weight_lb)
);

CREATE INDEX IF NOT EXISTS idx_item_dims_catalog_part
  ON item_dims_catalog(fishbowl_part_number);

-- RLS: Class O operations data — staff-tier read, service-role writes only
-- (migration 026 helpers; no client write policies by design).
ALTER TABLE item_dims_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read item_dims_catalog" ON item_dims_catalog
  FOR SELECT TO authenticated USING (is_staff_up());

COMMENT ON TABLE item_dims_catalog IS
  'Catalog-sourced shipping dims per Fishbowl part & pack level (Hercules/Fishbowl backfill); advisory tier below item_dims_verified';
COMMENT ON COLUMN item_dims_catalog.gross_weight_lb IS
  'Best available shipping weight for the pack; see weight_basis for source labeling';
COMMENT ON COLUMN item_dims_catalog.weight_basis IS
  'What the source labeled the weight as: gross_labeled, net_labeled, or unlabeled_assumed_gross (catalog convention)';
