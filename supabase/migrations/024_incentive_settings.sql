-- ============================================================
-- Q3 Incentive Program Settings
-- ============================================================
-- Admin-adjustable parameters for the incentive program live in
-- app_settings under one key. get_incentive_settings() is the single
-- SQL accessor: it fails loudly on missing/malformed config so
-- incentive math can never silently run with default rates.
--
-- Month/period boundaries are computed in America/Chicago per the PRD
-- acceptance criterion (an order at 11:58 PM CT on month-end must land
-- in that month).

INSERT INTO app_settings (key, value)
VALUES (
  'incentive_program',
  jsonb_build_object(
    'promo_start', '2026-07-01',
    'promo_end', '2026-09-30',
    'enrollment_gate', 2,
    'base_rate', 0.04,
    'bonus_rate', 0.02,
    'new_window_days', 90,
    'win_back_gap_days', 365
  )
)
ON CONFLICT (key) DO NOTHING;  -- never clobber admin edits

CREATE OR REPLACE FUNCTION get_incentive_settings()
RETURNS TABLE (
  promo_start TIMESTAMPTZ,
  promo_end_exclusive TIMESTAMPTZ,
  promo_start_date DATE,
  promo_end_date DATE,
  enrollment_gate INT,
  base_rate NUMERIC,
  bonus_rate NUMERIC,
  new_window_days INT,
  win_back_gap_days INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg JSONB;
BEGIN
  SELECT value INTO cfg FROM app_settings WHERE key = 'incentive_program';

  IF cfg IS NULL THEN
    RAISE EXCEPTION 'incentive_program settings missing from app_settings';
  END IF;

  IF cfg->>'promo_start' IS NULL OR cfg->>'promo_end' IS NULL
    OR cfg->>'enrollment_gate' IS NULL OR cfg->>'base_rate' IS NULL
    OR cfg->>'bonus_rate' IS NULL OR cfg->>'new_window_days' IS NULL
    OR cfg->>'win_back_gap_days' IS NULL
  THEN
    RAISE EXCEPTION 'incentive_program settings malformed (missing field): %', cfg;
  END IF;

  RETURN QUERY
  SELECT
    ((cfg->>'promo_start')::date::timestamp AT TIME ZONE 'America/Chicago'),
    (((cfg->>'promo_end')::date + 1)::timestamp AT TIME ZONE 'America/Chicago'),
    (cfg->>'promo_start')::date,
    (cfg->>'promo_end')::date,
    (cfg->>'enrollment_gate')::int,
    (cfg->>'base_rate')::numeric,
    (cfg->>'bonus_rate')::numeric,
    (cfg->>'new_window_days')::int,
    (cfg->>'win_back_gap_days')::int;
EXCEPTION
  WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'incentive_program settings malformed (unparseable value): %', cfg;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_incentive_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_incentive_settings() TO authenticated, service_role;
