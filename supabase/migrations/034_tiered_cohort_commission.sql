-- ============================================================
-- Tiered Cohort Commission Model (Steven, 2026-07-04)
-- ============================================================
-- Replaces the "4% base + gated 2% bonus" payout math. Commission now
-- keys off the 365-day revenue cohort engine (migration 028), with the
-- monthly enrollment quota putting the RECURRING rate at risk:
--
--   NEW cohort revenue      -> 6%  (first 365 days from enrollment)
--   WINBACK cohort revenue  -> 5%  (first 365 days from winback re-entry)
--   RECURRING revenue       -> tiered by that month's NEW-customer
--                              enrollments (winbacks do NOT count):
--                                >= enrollment_gate (2)  -> 4%
--                                1..gate-1               -> 3%  (penalty)
--                                0                       -> 2%  (penalty)
--
-- Consequences vs the old model (intentional, per Steven):
--   * The plan CAN pay less than the legacy 4% flat commission — a rep
--     with a big recurring book and a dry enrollment month takes a real
--     penalty. legacy_flat_commission is exposed so the app can show the
--     honest delta (positive or negative).
--   * Enrollment counting is unchanged: a customer's first-ever order,
--     credited to the first-order rep; a negative/house/no-rep first
--     order enrolls no one.
--   * Netting: every credit (EXCLUDED_NEGATIVE) reduces its own cohort
--     bucket in full — no per-customer floor. Buckets are netted per
--     rep-month; a heavily-negative bucket reduces the total.
--   * Attribution and exclusions still come from order_incentive_class
--     (house/system excluded, unmapped reps block payout with NULLs);
--     the RATE for each order comes from order_revenue_cohort.
--   * new_window_days moves 90 -> 365 so rep-facing "window closes"
--     countdowns match the 365-day period the 6% rate actually runs.
--
-- Rebuild order: settings JSON -> get_incentive_settings() (return type
-- grows, so dependent views are dropped and recreated) -> rollup view ->
-- variance view -> payout snapshot table (empty today; recreated with
-- cohort columns) -> freeze function -> reclassify.

-- ------------------------------------------------------------
-- 1) Settings: add tiered rates, widen the new window to 365d
-- ------------------------------------------------------------

UPDATE app_settings
SET value = value || jsonb_build_object(
      'new_rate', 0.06,
      'winback_rate', 0.05,
      'recurring_rate_full', 0.04,
      'recurring_rate_partial', 0.03,
      'recurring_rate_zero', 0.02,
      'new_window_days', 365
    ),
    updated_at = now()
WHERE key = 'incentive_program';

-- ------------------------------------------------------------
-- 2) Recreate the settings accessor with the new rate columns
-- ------------------------------------------------------------

DROP VIEW IF EXISTS v_incentive_payout_variance;
DROP VIEW IF EXISTS v_incentive_rep_month;
DROP VIEW IF EXISTS v_incentive_unmapped_salespersons;
DROP FUNCTION IF EXISTS get_incentive_settings();

CREATE FUNCTION get_incentive_settings()
RETURNS TABLE (
  promo_start TIMESTAMPTZ,
  promo_end_exclusive TIMESTAMPTZ,
  promo_start_date DATE,
  promo_end_date DATE,
  enrollment_gate INT,
  base_rate NUMERIC,              -- LEGACY flat rate; comparison display only
  bonus_rate NUMERIC,             -- LEGACY bonus rate; retired from payout
  new_rate NUMERIC,
  winback_rate NUMERIC,
  recurring_rate_full NUMERIC,
  recurring_rate_partial NUMERIC,
  recurring_rate_zero NUMERIC,
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
    OR cfg->>'new_rate' IS NULL OR cfg->>'winback_rate' IS NULL
    OR cfg->>'recurring_rate_full' IS NULL
    OR cfg->>'recurring_rate_partial' IS NULL
    OR cfg->>'recurring_rate_zero' IS NULL
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
    (cfg->>'new_rate')::numeric,
    (cfg->>'winback_rate')::numeric,
    (cfg->>'recurring_rate_full')::numeric,
    (cfg->>'recurring_rate_partial')::numeric,
    (cfg->>'recurring_rate_zero')::numeric,
    (cfg->>'new_window_days')::int,
    (cfg->>'win_back_gap_days')::int;
EXCEPTION
  WHEN invalid_text_representation OR datetime_field_overflow THEN
    RAISE EXCEPTION 'incentive_program settings malformed (unparseable value): %', cfg;
END;
$$;

REVOKE EXECUTE ON FUNCTION get_incentive_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_incentive_settings() TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) Recreate the unmapped-salesperson worklist (unchanged def)
-- ------------------------------------------------------------

CREATE VIEW v_incentive_unmapped_salespersons
WITH (security_invoker = true) AS
SELECT
  o.salesperson AS fishbowl_salesperson,
  COUNT(*) FILTER (WHERE o.canonical_state = 'order') AS order_count_all_time,
  COUNT(*) FILTER (
    WHERE o.canonical_state = 'order'
      AND o.sales_order_metric_at >= s.promo_start
      AND o.sales_order_metric_at < s.promo_end_exclusive
  ) AS order_count_in_period,
  COALESCE(SUM(COALESCE(o.total_amount, 0)) FILTER (
    WHERE o.canonical_state = 'order'
      AND o.sales_order_metric_at >= s.promo_start
      AND o.sales_order_metric_at < s.promo_end_exclusive
  ), 0) AS amount_in_period,
  MAX(o.sales_order_metric_at) FILTER (WHERE o.canonical_state = 'order') AS last_order_at
FROM fb_sales_orders o
CROSS JOIN get_incentive_settings() s
LEFT JOIN fishbowl_salesperson_aliases a
  ON a.fishbowl_salesperson = o.salesperson
WHERE NULLIF(BTRIM(o.salesperson), '') IS NOT NULL
  AND a.id IS NULL
GROUP BY o.salesperson, s.promo_start, s.promo_end_exclusive
ORDER BY order_count_in_period DESC, order_count_all_time DESC;

-- ------------------------------------------------------------
-- 4) The tiered rollup — the ONLY payout surface the app reads
-- ------------------------------------------------------------

CREATE VIEW v_incentive_rep_month
WITH (security_invoker = true) AS
WITH s AS (
  SELECT * FROM get_incentive_settings()
),
blocking AS (
  SELECT COUNT(DISTINCT oic.salesperson_raw) AS blocking_unmapped_count
  FROM order_incentive_class oic, s
  WHERE oic.rep_unmapped
    AND oic.order_at >= s.promo_start
    AND oic.order_at < s.promo_end_exclusive
),
joined AS (
  -- Attribution + exclusions from the incentive engine; the RATE bucket
  -- from the 365-day cohort engine. Credits keep their own cohort so
  -- they net against the bucket they belong to.
  SELECT
    oic.rep_key,
    oic.rep_display_name,
    oic.order_month,
    oic.net_amount,
    oic.class,
    COALESCE(orc.cohort, 'RECURRING') AS cohort
  FROM order_incentive_class oic
  LEFT JOIN order_revenue_cohort orc ON orc.so_number = oic.so_number
  WHERE oic.rep_key IS NOT NULL
    AND oic.class <> 'EXCLUDED_HOUSE'
),
rev AS (
  SELECT
    rep_key,
    MAX(rep_display_name) AS rep_display_name,
    order_month,
    COALESCE(SUM(net_amount) FILTER (WHERE cohort = 'NEW'), 0)       AS new_revenue,
    COALESCE(SUM(net_amount) FILTER (WHERE cohort = 'WINBACK'), 0)   AS winback_revenue,
    COALESCE(SUM(net_amount) FILTER (WHERE cohort = 'RECURRING'), 0) AS recurring_revenue,
    COALESCE(SUM(net_amount), 0) AS attributed_revenue,
    COUNT(*) AS order_count,
    COUNT(*) FILTER (WHERE cohort = 'NEW')       AS new_order_count,
    COUNT(*) FILTER (WHERE cohort = 'WINBACK')   AS winback_order_count,
    COUNT(*) FILTER (WHERE cohort = 'RECURRING') AS recurring_order_count,
    COALESCE(SUM(net_amount) FILTER (WHERE class = 'EXCLUDED_NEGATIVE'), 0) AS credit_amount,
    COUNT(*) FILTER (WHERE class = 'EXCLUDED_NEGATIVE') AS credit_count
  FROM joined
  GROUP BY rep_key, order_month
),
enroll AS (
  -- Enrollment = first completed order of a NEW customer, credited to the
  -- first-order rep in the first-order month. The first order must itself
  -- be NEW_WINDOW (a negative/house/no-rep first order enrolls no one).
  -- Winback re-entries do NOT count toward the quota.
  SELECT
    oic.rep_key,
    cfo.first_order_month AS order_month,
    COUNT(DISTINCT cfo.canonical_customer_key) AS enrollments
  FROM customer_first_order cfo
  JOIN order_incentive_class oic
    ON oic.so_number = cfo.first_order_so_number
  WHERE oic.class = 'NEW_WINDOW'
    AND oic.rep_key IS NOT NULL
  GROUP BY 1, 2
),
tiered AS (
  SELECT
    rev.*,
    COALESCE(enroll.enrollments, 0) AS enrollments,
    s.enrollment_gate,
    s.base_rate,
    s.new_rate,
    s.winback_rate,
    s.promo_start_date,
    s.promo_end_date,
    CASE
      WHEN COALESCE(enroll.enrollments, 0) >= s.enrollment_gate THEN s.recurring_rate_full
      WHEN COALESCE(enroll.enrollments, 0) >= 1 THEN s.recurring_rate_partial
      ELSE s.recurring_rate_zero
    END AS recurring_rate
  FROM rev
  CROSS JOIN s
  LEFT JOIN enroll ON enroll.rep_key = rev.rep_key AND enroll.order_month = rev.order_month
)
SELECT
  t.rep_key,
  t.rep_display_name,
  t.order_month AS month,
  (t.order_month >= date_trunc('month', t.promo_start_date)::date
    AND t.order_month <= date_trunc('month', t.promo_end_date)::date) AS in_promo_period,
  t.enrollments,
  t.enrollment_gate,
  (t.enrollments >= t.enrollment_gate) AS qualifies,
  t.recurring_rate,
  t.order_count,
  t.new_order_count,
  t.winback_order_count,
  t.recurring_order_count,
  t.new_revenue,
  t.winback_revenue,
  t.recurring_revenue,
  t.attributed_revenue,
  t.credit_amount,
  t.credit_count,
  b.blocking_unmapped_count,
  CASE WHEN b.blocking_unmapped_count = 0
       THEN ROUND(t.new_rate * t.new_revenue, 2)
  END AS new_commission,
  CASE WHEN b.blocking_unmapped_count = 0
       THEN ROUND(t.winback_rate * t.winback_revenue, 2)
  END AS winback_commission,
  CASE WHEN b.blocking_unmapped_count = 0
       THEN ROUND(t.recurring_rate * t.recurring_revenue, 2)
  END AS recurring_commission,
  CASE WHEN b.blocking_unmapped_count = 0
       THEN ROUND(t.new_rate * t.new_revenue, 2)
            + ROUND(t.winback_rate * t.winback_revenue, 2)
            + ROUND(t.recurring_rate * t.recurring_revenue, 2)
  END AS projected_total,
  CASE WHEN b.blocking_unmapped_count = 0
       THEN ROUND(t.base_rate * t.attributed_revenue, 2)
  END AS legacy_flat_commission
FROM tiered t
CROSS JOIN blocking b;

-- ------------------------------------------------------------
-- 5) Order-level audit view gains the cohort columns
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW v_incentive_order_detail
WITH (security_invoker = true) AS
SELECT
  oic.so_number,
  oic.order_at,
  oic.order_month,
  oic.class,
  oic.class_reason,
  oic.canonical_customer_key,
  oic.raw_customer_key,
  fso.customer_name,
  fso.status,
  oic.salesperson_raw,
  oic.rep_key,
  oic.rep_display_name,
  oic.rep_unmapped,
  oic.amount,
  oic.net_amount,
  oic.prior_order_so_number,
  oic.prior_order_at,
  oic.prior_gap_days,
  oic.is_first_order,
  oic.computed_at,
  orc.cohort,
  orc.cohort_reason
FROM order_incentive_class oic
JOIN fb_sales_orders fso ON fso.so_number = oic.so_number
LEFT JOIN order_revenue_cohort orc ON orc.so_number = oic.so_number;

-- ------------------------------------------------------------
-- 6) Payout snapshot: recreate with cohort columns
-- ------------------------------------------------------------
-- Guard: this table must be empty (nothing has been frozen yet).
-- If finance has frozen a month by the time this runs, STOP — migrate
-- the rows by hand instead of dropping paid figures.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM incentive_payout_snapshot) THEN
    RAISE EXCEPTION 'incentive_payout_snapshot is not empty; refusing to drop frozen payout figures';
  END IF;
END $$;

DROP TABLE incentive_payout_snapshot;

CREATE TABLE incentive_payout_snapshot (
  month DATE NOT NULL,
  rep_key TEXT NOT NULL,
  rep_display_name TEXT,
  enrollments INT NOT NULL,
  enrollment_gate INT NOT NULL,
  qualifies BOOLEAN NOT NULL,
  recurring_rate NUMERIC NOT NULL,
  order_count INT NOT NULL,
  new_revenue NUMERIC NOT NULL,
  winback_revenue NUMERIC NOT NULL,
  recurring_revenue NUMERIC NOT NULL,
  attributed_revenue NUMERIC NOT NULL,
  new_commission NUMERIC NOT NULL,
  winback_commission NUMERIC NOT NULL,
  recurring_commission NUMERIC NOT NULL,
  projected_total NUMERIC NOT NULL,
  legacy_flat_commission NUMERIC NOT NULL,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  frozen_by TEXT,
  PRIMARY KEY (month, rep_key)
);

ALTER TABLE incentive_payout_snapshot ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'incentive_payout_snapshot' AND policyname = 'staff read incentive_payout_snapshot'
  ) THEN
    CREATE POLICY "staff read incentive_payout_snapshot" ON incentive_payout_snapshot
      FOR SELECT TO authenticated USING (is_staff_up());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION freeze_incentive_month(p_month DATE, p_frozen_by TEXT DEFAULT NULL, p_force BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE := date_trunc('month', p_month)::date;
  v_month_end_chicago TIMESTAMPTZ := ((v_month + INTERVAL '1 month')::date::text || ' 00:00:00')::timestamp AT TIME ZONE 'America/Chicago';
  v_rows INT := 0;
  v_blocked INT := 0;
BEGIN
  IF now() < v_month_end_chicago THEN
    RAISE EXCEPTION 'Cannot freeze %: the month is not over in America/Chicago yet', v_month;
  END IF;

  IF EXISTS (SELECT 1 FROM incentive_payout_snapshot WHERE month = v_month) THEN
    IF NOT p_force THEN
      RAISE EXCEPTION 'Month % is already frozen; refusing to overwrite paid figures without p_force', v_month;
    END IF;
    DELETE FROM incentive_payout_snapshot WHERE month = v_month;
  END IF;

  SELECT COUNT(*) INTO v_blocked
  FROM v_incentive_rep_month
  WHERE month = v_month AND blocking_unmapped_count > 0;

  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'Cannot freeze %: % rep rows are payout-blocked by unmapped salespersons — resolve aliases first', v_month, v_blocked;
  END IF;

  INSERT INTO incentive_payout_snapshot (
    month, rep_key, rep_display_name, enrollments, enrollment_gate, qualifies,
    recurring_rate, order_count, new_revenue, winback_revenue, recurring_revenue,
    attributed_revenue, new_commission, winback_commission, recurring_commission,
    projected_total, legacy_flat_commission, frozen_at, frozen_by
  )
  SELECT month, rep_key, rep_display_name, enrollments, enrollment_gate, qualifies,
         recurring_rate, order_count, new_revenue, winback_revenue, recurring_revenue,
         attributed_revenue, COALESCE(new_commission, 0), COALESCE(winback_commission, 0),
         COALESCE(recurring_commission, 0), COALESCE(projected_total, 0),
         COALESCE(legacy_flat_commission, 0), now(), p_frozen_by
  FROM v_incentive_rep_month
  WHERE month = v_month;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'month', v_month,
    'reps_frozen', v_rows,
    'total_commission', (SELECT COALESCE(SUM(projected_total), 0) FROM incentive_payout_snapshot WHERE month = v_month),
    'frozen_at', now(),
    'frozen_by', p_frozen_by
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION freeze_incentive_month(DATE, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION freeze_incentive_month(DATE, TEXT, BOOLEAN) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION freeze_incentive_month(DATE, TEXT, BOOLEAN) TO service_role;

-- ------------------------------------------------------------
-- 7) Variance view (definition unchanged from 032)
-- ------------------------------------------------------------

CREATE VIEW v_incentive_payout_variance WITH (security_invoker = true) AS
SELECT
  s.month,
  s.rep_key,
  COALESCE(s.rep_display_name, l.rep_display_name) AS rep_display_name,
  s.frozen_at,
  s.projected_total AS frozen_total,
  COALESCE(l.projected_total, 0) AS live_total,
  COALESCE(l.projected_total, 0) - s.projected_total AS variance,
  s.enrollments AS frozen_enrollments,
  COALESCE(l.enrollments, 0) AS live_enrollments,
  s.qualifies AS frozen_qualifies,
  COALESCE(l.qualifies, false) AS live_qualifies,
  (l.rep_key IS NULL) AS rep_gone_from_live,
  COALESCE(l.blocking_unmapped_count, 0) > 0 AS live_blocked
FROM incentive_payout_snapshot s
LEFT JOIN v_incentive_rep_month l ON l.month = s.month AND l.rep_key = s.rep_key;

-- ------------------------------------------------------------
-- 8) Reclassify: new_window_days is now 365
-- ------------------------------------------------------------

SELECT refresh_incentive_classification();
