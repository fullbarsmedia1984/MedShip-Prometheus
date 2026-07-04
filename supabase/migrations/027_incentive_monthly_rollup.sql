-- ============================================================
-- Q3 Incentive — Monthly Rep Rollup
-- ============================================================
-- v_incentive_rep_month is the ONLY payout surface the app reads.
--
-- Fail-loudly contract: blocking_unmapped_count (distinct unmapped
-- salesperson strings with orders inside the promo period) appears on
-- every row; when it is > 0, base_commission and bonus_commission are
-- SQL NULL, so the app physically cannot render payout figures.
--
-- Attribution: each order's own rep earns its base/bonus revenue; the
-- FIRST-order rep earns the enrollment credit (PRD §5).
--
-- Negative netting: EXCLUDED_NEGATIVE orders net per customer-month
-- against that same customer's NEW_WINDOW revenue only, floored at 0
-- per customer-month; negatives always reduce attributed (base) revenue.

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
  -- Enrollment = first completed order of a new customer, credited to
  -- the first-order rep in the first-order month. The first order must
  -- itself be NEW_WINDOW (a negative/house/no-rep first order enrolls no one).
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
    -- House/system identities never earn commission and must not appear
    -- as leaderboard rows (their orders are surfaced on the exceptions
    -- panel instead).
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

-- Reconciliation exceptions: orders whose header total_amount diverges from
-- the sum of line-item total_price beyond a $0.01 tolerance. Accounting
-- reviews bonus-eligible orders in this set before payout (PRD 4.4 — we pay
-- on header total_amount but surface the divergence, never "fix" it here).
CREATE OR REPLACE VIEW v_incentive_reconciliation_exceptions
WITH (security_invoker = true) AS
WITH line_sums AS (
  SELECT sales_order_number, SUM(total_price) AS line_sum
  FROM fb_sales_order_items
  GROUP BY sales_order_number
)
SELECT
  o.so_number,
  o.customer_name,
  o.salesperson,
  o.sales_order_metric_at AS order_at,
  o.total_amount,
  COALESCE(ls.line_sum, 0) AS line_item_sum,
  COALESCE(o.total_amount, 0) - COALESCE(ls.line_sum, 0) AS divergence,
  oic.class,
  oic.rep_display_name
FROM fb_sales_orders o
LEFT JOIN line_sums ls ON ls.sales_order_number = o.so_number
LEFT JOIN order_incentive_class oic ON oic.so_number = o.so_number
WHERE o.canonical_state = 'order'
  AND ABS(COALESCE(o.total_amount, 0) - COALESCE(ls.line_sum, 0)) > 0.01;

-- Audit drill-down: every classified order with its human-readable reason.
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
  oic.computed_at
FROM order_incentive_class oic
JOIN fb_sales_orders fso ON fso.so_number = oic.so_number;
