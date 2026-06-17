-- ============================================================
-- Sales Dashboard Operational Revenue
-- Maps Fishbowl salesperson aliases to Zeus/Salesforce reps so
-- dashboard revenue can come from issued Fishbowl Sales Orders.
-- ============================================================

CREATE TABLE IF NOT EXISTS fishbowl_salesperson_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fishbowl_salesperson TEXT NOT NULL UNIQUE,
    sf_user_id TEXT REFERENCES sf_users(sf_id) ON DELETE SET NULL,
    display_name TEXT NOT NULL,
    team TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_house_account BOOLEAN NOT NULL DEFAULT false,
    is_system_alias BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (length(trim(fishbowl_salesperson)) > 0),
    CHECK (length(trim(display_name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_fb_salesperson_aliases_sf_user
  ON fishbowl_salesperson_aliases(sf_user_id);

CREATE INDEX IF NOT EXISTS idx_fb_salesperson_aliases_flags
  ON fishbowl_salesperson_aliases(is_active, is_house_account, is_system_alias);

CREATE INDEX IF NOT EXISTS idx_fb_so_operational_metric_date
  ON fb_sales_orders(canonical_state, salesperson, date_issued DESC NULLS LAST, date_completed DESC NULLS LAST, date_created DESC NULLS LAST);

ALTER TABLE fishbowl_salesperson_aliases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'fishbowl_salesperson_aliases'
      AND policyname = 'auth read fishbowl_salesperson_aliases'
  ) THEN
    CREATE POLICY "auth read fishbowl_salesperson_aliases"
      ON fishbowl_salesperson_aliases FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

INSERT INTO fishbowl_salesperson_aliases (
  fishbowl_salesperson,
  sf_user_id,
  display_name,
  team,
  is_house_account,
  is_system_alias
)
SELECT *
FROM (
  VALUES
    ('MikeF', '0052E00000Ip9EmQAJ', 'Mike Franzese', 'Sales', false, false),
    ('Leo', '0052E00000JxFvcQAF', 'Leo Joanidhi', 'Sales', false, false),
    ('selliott', '0052E00000NdGDeQAN', 'Samantha Elliott', 'Sales', false, false),
    ('Samantha', '0052E00000NdGDeQAN', 'Samantha Elliott', 'Sales', false, false),
    ('dtorres', '0052E00000M1qRMQAZ', 'Danny Torres', 'Sales', false, false),
    ('Dan', '0052E00000Hlo1lQAB', 'Dan Micic', 'Sales', false, false),
    ('svasic', '0052E00000Ip9DhQAJ', 'Stefan Vasic', 'Sales', false, false),
    ('kbugarski', '0052E00000Kuuj8QAB', 'Kristina Bugarski', 'Sales', false, false),
    ('Christine', '0052E00000M1j73QAB', 'Christine Livingstone', 'Sales', false, false),
    ('Nikola', '005Ua00000EnNsTIAV', 'Nikola Kovilic', 'Sales', false, false),
    ('kdedvukaj', '005Ua000008QA96IAG', 'Kendall Cook', 'Sales', false, false),
    ('admin', null, 'Fishbowl Admin / Legacy', 'System', false, true),
    ('MedShip', null, 'Medical Shipment House Account', 'House', true, false),
    ('House Account', null, 'House Account', 'House', true, false),
    ('Warehouse', null, 'Warehouse', 'System', false, true)
) AS seed(fishbowl_salesperson, sf_user_id, display_name, team, is_house_account, is_system_alias)
ON CONFLICT (fishbowl_salesperson) DO UPDATE
SET
  sf_user_id = EXCLUDED.sf_user_id,
  display_name = EXCLUDED.display_name,
  team = EXCLUDED.team,
  is_house_account = EXCLUDED.is_house_account,
  is_system_alias = EXCLUDED.is_system_alias,
  updated_at = now();
