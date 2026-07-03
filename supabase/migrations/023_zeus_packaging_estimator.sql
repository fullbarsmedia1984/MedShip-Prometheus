-- ============================================================
-- Zeus Packaging Estimator
-- Deterministic bin-packing estimates for quote shipping.
-- Tables: standard_boxes, packing_rules, item_dims_verified,
--         estimates, estimator_llm_calls
-- ============================================================

-- ------------------------------------------------------------
-- Standard shipping boxes (admin-managed)
-- Dims supplied by Steven are inner dims; outer dims assume
-- standard 200# single-wall corrugated (~0.25 in per wall).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS standard_boxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  inner_length_in NUMERIC NOT NULL CHECK (inner_length_in > 0),
  inner_width_in NUMERIC NOT NULL CHECK (inner_width_in > 0),
  inner_height_in NUMERIC NOT NULL CHECK (inner_height_in > 0),
  outer_length_in NUMERIC NOT NULL CHECK (outer_length_in > 0),
  outer_width_in NUMERIC NOT NULL CHECK (outer_width_in > 0),
  outer_height_in NUMERIC NOT NULL CHECK (outer_height_in > 0),
  box_weight_lb NUMERIC NOT NULL DEFAULT 0 CHECK (box_weight_lb >= 0),
  max_content_weight_lb NUMERIC NOT NULL DEFAULT 50 CHECK (max_content_weight_lb > 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO standard_boxes
  (name, inner_length_in, inner_width_in, inner_height_in,
   outer_length_in, outer_width_in, outer_height_in,
   box_weight_lb, max_content_weight_lb)
VALUES
  ('Box 30x24x20', 30, 24, 20, 30.5, 24.5, 20.5, 3.9, 50),
  ('Box 30x17x17', 30, 17, 17, 30.5, 17.5, 17.5, 2.9, 50),
  ('Box 18x16x16', 18, 16, 16, 18.5, 16.5, 16.5, 1.9, 50),
  ('Box 16x13x13', 16, 13, 13, 16.5, 13.5, 13.5, 1.4, 50),
  ('Box 20x14x6',  20, 14, 6,  20.5, 14.5, 6.5,  1.1, 50),
  ('Box 18x12x5',  18, 12, 5,  18.5, 12.5, 5.5,  0.9, 50),
  ('Box 12x10x8',  12, 10, 8,  12.5, 10.5, 8.5,  0.7, 50)
ON CONFLICT (name) DO NOTHING;

-- ------------------------------------------------------------
-- Packing rules (single keyed config row; machine-readable SOP)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS packing_rules (
  key TEXT PRIMARY KEY,
  rules JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO packing_rules (key, rules) VALUES ('default', '{
  "fill_factor": 0.85,
  "max_box_weight_lb": 50,
  "dim_divisor": 139,
  "segregate_liquids": true,
  "parcel_max": {
    "single_package_weight_lb": 150,
    "max_length_in": 108,
    "max_length_plus_girth_in": 165
  },
  "ltl_triggers": {
    "total_billable_weight_lb": 500,
    "carton_count": 6,
    "dim_weight_flag_threshold_lb": 50
  },
  "pallet": {
    "length_in": 48,
    "width_in": 40,
    "deck_height_in": 5.5,
    "deck_weight_lb": 45,
    "max_height_in": 72,
    "max_weight_lb": 1500,
    "max_piece_weight_lb": 4000,
    "stack_fill_factor": 0.9
  },
  "llm_confidence_threshold": 0.7,
  "estimate_confidence_threshold": 0.7
}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- Verified item dimensions (canonical override layer over
-- Fishbowl advisory dims; built incrementally by the quote flow)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS item_dims_verified (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fishbowl_part_number TEXT NOT NULL UNIQUE,
  length_in NUMERIC NOT NULL CHECK (length_in > 0),
  width_in NUMERIC NOT NULL CHECK (width_in > 0),
  height_in NUMERIC NOT NULL CHECK (height_in > 0),
  weight_lb NUMERIC NOT NULL CHECK (weight_lb >= 0),
  ships_in_own_carton BOOLEAN NOT NULL DEFAULT false,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL CHECK (source IN ('manufacturer_site', 'physical_measurement', 'fishbowl_confirmed')),
  source_url TEXT,
  llm_suggested BOOLEAN NOT NULL DEFAULT false,
  verified_by TEXT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_dims_verified_part
  ON item_dims_verified(fishbowl_part_number);

-- ------------------------------------------------------------
-- Estimate audit log (input snapshot => reproducibility;
-- actual_boxes_used filled post-hoc for the feedback loop)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  so_number TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  input_snapshot JSONB NOT NULL,
  pack_plan JSONB NOT NULL,
  confidence_score NUMERIC NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  llm_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  actual_boxes_used JSONB,
  actual_recorded_by TEXT,
  actual_recorded_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_estimates_so_number ON estimates(so_number);
CREATE INDEX IF NOT EXISTS idx_estimates_created_at ON estimates(created_at DESC);

-- ------------------------------------------------------------
-- LLM call log (cost/quality monitoring; never blocks pipeline)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estimator_llm_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose TEXT NOT NULL CHECK (purpose IN ('classify_attributes', 'suggest_dimensions', 'review_pack_plan')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  success BOOLEAN NOT NULL,
  error TEXT,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_estimator_llm_calls_created_at
  ON estimator_llm_calls(created_at DESC);

-- ------------------------------------------------------------
-- Row level security: service-role access only (matches the
-- pattern used by other Prometheus operational tables).
-- ------------------------------------------------------------
ALTER TABLE standard_boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE packing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_dims_verified ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimator_llm_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read standard_boxes" ON standard_boxes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read packing_rules" ON packing_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read item_dims_verified" ON item_dims_verified FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read estimates" ON estimates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read estimator_llm_calls" ON estimator_llm_calls FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE standard_boxes IS 'Standard shipping boxes available to the Zeus packaging estimator';
COMMENT ON TABLE packing_rules IS 'Configurable packing/palletizing rules — machine-readable twin of the packing SOP';
COMMENT ON TABLE item_dims_verified IS 'Canonical verified shipping dims per Fishbowl part; overrides advisory Fishbowl dims';
COMMENT ON TABLE estimates IS 'Packaging estimate audit log with input snapshots for reproducibility';
COMMENT ON TABLE estimator_llm_calls IS 'Log of LLM assist calls made by the estimator (classification, dim suggestions, plan review)';
