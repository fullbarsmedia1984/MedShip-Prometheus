-- ============================================================
-- Sales Territories (Steven, 2026-07-04)
-- ============================================================
-- Authoritative territory -> state mapping, confirmed by Steven from the
-- revenue-footprint draft. Five territories cover all 50 states + DC.
-- Revenue attribution to a territory is GEOGRAPHIC (order ship_to_state),
-- never by selling rep. The Central territory (formerly Kristal's) is
-- currently unassigned — rep fields are NULL by design.
-- This table also seeds the future territory-assignment dashboard.

CREATE TABLE IF NOT EXISTS sales_territories (
  territory_key TEXT PRIMARY KEY,
  territory_name TEXT NOT NULL,
  rep_display_name TEXT,          -- NULL = unassigned territory
  rep_sf_user_id TEXT,
  notes TEXT,
  sort_order INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_territory_states (
  state TEXT PRIMARY KEY,         -- 2-letter code; includes DC
  territory_key TEXT NOT NULL REFERENCES sales_territories(territory_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sales_territory_states_key ON sales_territory_states(territory_key);

ALTER TABLE sales_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_territory_states ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sales_territories' AND policyname = 'auth read sales_territories'
  ) THEN
    CREATE POLICY "auth read sales_territories" ON sales_territories
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'sales_territory_states' AND policyname = 'auth read sales_territory_states'
  ) THEN
    CREATE POLICY "auth read sales_territory_states" ON sales_territory_states
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- Seed (never clobber later admin edits)
INSERT INTO sales_territories (territory_key, territory_name, rep_display_name, rep_sf_user_id, notes, sort_order) VALUES
  ('northeast',    'Northeast',    'Danny Torres',     '0052E00000M1qRMQAZ', NULL, 10),
  ('west',         'West',         'Leo Joanidhi',     '0052E00000JxFvcQAF', NULL, 20),
  ('south',        'South',        'Samantha Elliott', '0052E00000NdGDeQAN', NULL, 30),
  ('mid_atlantic', 'Mid-Atlantic', 'Mike Franzese',    '0052E00000Ip9EmQAJ', NULL, 40),
  ('central',      'Central',      NULL,               NULL,                 'Formerly Kristal''s territory; currently unassigned', 50)
ON CONFLICT (territory_key) DO NOTHING;

INSERT INTO sales_territory_states (state, territory_key) VALUES
  -- Northeast (Torres)
  ('NY','northeast'),('MA','northeast'),('CT','northeast'),('NJ','northeast'),
  ('RI','northeast'),('PA','northeast'),('NH','northeast'),('ME','northeast'),('VT','northeast'),
  -- West (Joanidhi)
  ('CA','west'),('NV','west'),('WA','west'),('UT','west'),('AZ','west'),
  ('HI','west'),('AK','west'),('OR','west'),('ID','west'),
  -- South (Elliott)
  ('TX','south'),('FL','south'),('AR','south'),('LA','south'),('AL','south'),
  ('GA','south'),('MS','south'),('SC','south'),('OK','south'),
  -- Mid-Atlantic (Franzese)
  ('TN','mid_atlantic'),('VA','mid_atlantic'),('NC','mid_atlantic'),('MO','mid_atlantic'),
  ('KY','mid_atlantic'),('MN','mid_atlantic'),('IA','mid_atlantic'),('MD','mid_atlantic'),
  ('DC','mid_atlantic'),('WV','mid_atlantic'),('DE','mid_atlantic'),
  -- Central (unassigned; formerly Kristal)
  ('OH','central'),('WI','central'),('IL','central'),('CO','central'),('KS','central'),
  ('MI','central'),('NM','central'),('WY','central'),('IN','central'),('SD','central'),
  ('ND','central'),('MT','central'),('NE','central')
ON CONFLICT (state) DO NOTHING;

-- Sanity: 50 states + DC = 51 rows expected
DO $$
DECLARE v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count FROM sales_territory_states;
  IF v_count <> 51 THEN
    RAISE EXCEPTION 'sales_territory_states has % rows; expected 51 (50 states + DC)', v_count;
  END IF;
END $$;
