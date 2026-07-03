-- Reconciled from live DB: applied 2026-07-02 as version 20260702220435
-- "incentive_rollup_exclude_house_rows" via MCP apply_migration, but never
-- committed to the repo. Recorded verbatim for repo/schema parity.
-- Do NOT re-apply to the production project.

-- House/system identities must not materialize as leaderboard rows in
-- v_incentive_rep_month (their orders remain visible on the exceptions
-- panel). Redefines the rollup with EXCLUDED_HOUSE filtered out of the
-- per-rep revenue CTE.

CREATE OR REPLACE VIEW v_incentive_rep_month
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
cust_month_new AS (
  SELECT
    canonical_customer_key,
    order_month,
    rep_key,
    SUM(net_amount) FILTER (WHERE class = 'NEW_WINDOW') AS new_window_gross,
    SUM(net_amount) FILTER (WHERE class = 'EXCLUDED_NEGATIVE') AS negatives
  FROM order_incentive_class
  WHERE rep_key IS NOT NULL
  GROUP BY 1, 2, 3
),
netted AS (
  SELECT
    rep_key,
    order_month,
    SUM(GREATEST(COALESCE(new_window_gross, 0) + COALESCE(negatives, 0), 0))
      FILTER (WHERE COALESCE(new_window_gross, 0) > 0) AS net_new_customer_revenue
  FROM cust_month_new
  GROUP BY 1, 2
),
enroll AS (
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
rev AS (
  SELECT
    rep_key,
    MAX(rep_display_name) AS rep_display_name,
    order_month,
    SUM(net_amount) FILTER (WHERE class IN ('NEW_WINDOW', 'RECURRING', 'WIN_BACK', 'EXCLUDED_NEGATIVE'))
      AS attributed_revenue,
    SUM(net_amount) FILTER (WHERE class = 'NEW_WINDOW') AS new_customer_revenue_gross,
    SUM(net_amount) FILTER (WHERE class = 'WIN_BACK') AS win_back_revenue,
    COUNT(*) AS order_count,
    COUNT(*) FILTER (WHERE class = 'NEW_WINDOW') AS new_window_order_count
  FROM order_incentive_class
  WHERE rep_key IS NOT NULL
    AND class <> 'EXCLUDED_HOUSE'
  GROUP BY rep_key, order_month
)
SELECT
  rev.rep_key,
  rev.rep_display_name,
  rev.order_month AS month,
  (rev.order_month >= date_trunc('month', s.promo_start_date)::date
    AND rev.order_month <= date_trunc('month', s.promo_end_date)::date) AS in_promo_period,
  COALESCE(enroll.enrollments, 0) AS enrollments,
  s.enrollment_gate,
  (COALESCE(enroll.enrollments, 0) >= s.enrollment_gate) AS qualifies,
  rev.order_count,
  rev.new_window_order_count,
  COALESCE(rev.attributed_revenue, 0) AS attributed_revenue,
  COALESCE(rev.new_customer_revenue_gross, 0) AS new_customer_revenue_gross,
  COALESCE(netted.net_new_customer_revenue, 0) AS net_new_customer_revenue,
  COALESCE(rev.win_back_revenue, 0) AS win_back_revenue,
  b.blocking_unmapped_count,
  CASE WHEN b.blocking_unmapped_count = 0
       THEN ROUND(s.base_rate * COALESCE(rev.attributed_revenue, 0), 2)
  END AS base_commission,
  CASE WHEN b.blocking_unmapped_count = 0
       THEN CASE WHEN COALESCE(enroll.enrollments, 0) >= s.enrollment_gate
                 THEN ROUND(s.bonus_rate * COALESCE(netted.net_new_customer_revenue, 0), 2)
                 ELSE 0
            END
  END AS bonus_commission,
  CASE WHEN b.blocking_unmapped_count = 0
       THEN ROUND(s.base_rate * COALESCE(rev.attributed_revenue, 0), 2)
            + CASE WHEN COALESCE(enroll.enrollments, 0) >= s.enrollment_gate
                   THEN ROUND(s.bonus_rate * COALESCE(netted.net_new_customer_revenue, 0), 2)
                   ELSE 0
              END
  END AS projected_total
FROM rev
CROSS JOIN s
CROSS JOIN blocking b
LEFT JOIN enroll ON enroll.rep_key = rev.rep_key AND enroll.order_month = rev.order_month
LEFT JOIN netted ON netted.rep_key = rev.rep_key AND netted.order_month = rev.order_month;
