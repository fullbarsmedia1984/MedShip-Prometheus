-- Reconciled from live DB: applied 2026-07-03 as version 20260703195759
-- "revenue_cohort_reason_fix" via MCP apply_migration, but never committed
-- to the repo. Recorded verbatim for repo/schema parity.
-- Do NOT re-apply to the production project.

-- Fix audit-text templates in refresh_revenue_cohorts():
--  * RECURRING rows claimed "this customer first bought <period_start>",
--    but for a customer whose most recent period was WINBACK, period_start
--    is the winback date, not the first purchase. Drop the false claim.
--  * "period runs 365-day through X" phrasing cleaned up.
-- Classification logic is UNCHANGED — only cohort_reason strings.

CREATE OR REPLACE FUNCTION refresh_revenue_cohorts(
  p_new_period_days INT DEFAULT 365,
  p_winback_gap_days INT DEFAULT 365,
  p_winback_period_days INT DEFAULT 365
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orders INT := 0;
  v_by_cohort JSONB;
  v_result JSONB;
BEGIN
  TRUNCATE order_revenue_cohort;

  INSERT INTO order_revenue_cohort (
    so_number, canonical_customer_key, raw_customer_key, order_at, order_month,
    amount, cohort, is_cohort_entry, cohort_entered_at, cohort_entry_so,
    cohort_expires_at, prior_order_so_number, prior_order_at, prior_gap_days,
    cohort_reason, computed_at
  )
  WITH src AS (
    SELECT
      so_number,
      business_customer_key AS raw_key,
      resolve_canonical_customer_key(business_customer_key) AS ckey,
      sales_order_metric_at AS order_at,
      total_amount
    FROM fb_sales_orders
    WHERE canonical_state = 'order'
      AND sales_order_metric_at IS NOT NULL
  ),
  seq AS (
    SELECT
      src.*,
      LAG(order_at) OVER w AS prior_at,
      LAG(so_number) OVER w AS prior_so,
      ROW_NUMBER() OVER w AS rn
    FROM src
    WINDOW w AS (
      PARTITION BY COALESCE(ckey, 'so:' || so_number)
      ORDER BY order_at ASC, so_number ASC
    )
  ),
  entries AS (
    SELECT
      seq.*,
      CASE
        WHEN rn = 1 THEN 'NEW'
        WHEN order_at - prior_at >= make_interval(days => p_winback_gap_days) THEN 'WINBACK'
      END AS entry_type
    FROM seq
  ),
  grouped AS (
    SELECT
      e.*,
      COUNT(entry_type) OVER (
        PARTITION BY COALESCE(ckey, 'so:' || so_number)
        ORDER BY order_at ASC, so_number ASC
        ROWS UNBOUNDED PRECEDING
      ) AS period_grp
    FROM entries e
  ),
  resolved AS (
    SELECT
      g.*,
      FIRST_VALUE(entry_type) OVER wp AS period_type,
      FIRST_VALUE(order_at)   OVER wp AS period_start,
      FIRST_VALUE(so_number)  OVER wp AS period_so,
      FIRST_VALUE(prior_so)   OVER wp AS entry_prior_so,
      FIRST_VALUE(prior_at)   OVER wp AS entry_prior_at
    FROM grouped g
    WINDOW wp AS (
      PARTITION BY COALESCE(ckey, 'so:' || so_number), period_grp
      ORDER BY order_at ASC, so_number ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )
  ),
  classified AS (
    SELECT
      r.*,
      r.period_start + make_interval(days =>
        CASE r.period_type WHEN 'NEW' THEN p_new_period_days ELSE p_winback_period_days END
      ) AS period_end,
      CASE
        WHEN r.ckey IS NULL THEN 'RECURRING'
        WHEN r.period_type = 'NEW'
             AND r.order_at < r.period_start + make_interval(days => p_new_period_days)
          THEN 'NEW'
        WHEN r.period_type = 'WINBACK'
             AND r.order_at < r.period_start + make_interval(days => p_winback_period_days)
          THEN 'WINBACK'
        ELSE 'RECURRING'
      END AS cohort
    FROM resolved r
  )
  SELECT
    c.so_number,
    c.ckey,
    c.raw_key,
    c.order_at,
    (date_trunc('month', c.order_at AT TIME ZONE 'America/Chicago'))::date,
    c.total_amount,
    c.cohort,
    (c.cohort IN ('NEW', 'WINBACK') AND c.so_number = c.period_so),
    CASE WHEN c.cohort IN ('NEW', 'WINBACK') THEN c.period_start ELSE c.order_at END,
    CASE WHEN c.cohort IN ('NEW', 'WINBACK') THEN c.period_so ELSE c.so_number END,
    CASE WHEN c.cohort IN ('NEW', 'WINBACK') THEN c.period_end END,
    c.prior_so,
    c.prior_at,
    CASE WHEN c.prior_at IS NOT NULL
         THEN FLOOR(EXTRACT(EPOCH FROM (c.order_at - c.prior_at)) / 86400)::int
    END,
    CASE
      WHEN c.ckey IS NULL THEN
        'RECURRING: no customer identity (business_customer_key is null); first-purchase history cannot be established'
      WHEN c.cohort = 'NEW' AND c.so_number = c.period_so THEN
        format('NEW: first-ever purchase by this customer — no prior SO on record; %s-day NEW period ends %s',
          p_new_period_days, to_char(c.period_end, 'YYYY-MM-DD'))
      WHEN c.cohort = 'NEW' THEN
        format('NEW: within the %s-day NEW period opened by first-ever SO %s on %s; period ends %s',
          p_new_period_days, c.period_so, to_char(c.period_start, 'YYYY-MM-DD'),
          to_char(c.period_end, 'YYYY-MM-DD'))
      WHEN c.cohort = 'WINBACK' AND c.so_number = c.period_so THEN
        format('WINBACK: prior purchase SO %s on %s, lapse %s days >= %s; %s-day WINBACK period ends %s',
          c.entry_prior_so, to_char(c.entry_prior_at, 'YYYY-MM-DD'),
          FLOOR(EXTRACT(EPOCH FROM (c.order_at - c.entry_prior_at)) / 86400)::int,
          p_winback_gap_days, p_winback_period_days, to_char(c.period_end, 'YYYY-MM-DD'))
      WHEN c.cohort = 'WINBACK' THEN
        format('WINBACK: within the %s-day WINBACK period opened by SO %s on %s (returned after a %s-day lapse); period ends %s',
          p_winback_period_days, c.period_so, to_char(c.period_start, 'YYYY-MM-DD'),
          FLOOR(EXTRACT(EPOCH FROM (c.period_start - c.entry_prior_at)) / 86400)::int,
          to_char(c.period_end, 'YYYY-MM-DD'))
      ELSE
        format('RECURRING: %s period opened by SO %s on %s ended %s; prior order SO %s was only %s days earlier (< %s-day lapse) — neither a first-ever purchase nor a return from a %s-day lapse',
          c.period_type, c.period_so, to_char(c.period_start, 'YYYY-MM-DD'),
          to_char(c.period_end, 'YYYY-MM-DD'),
          c.prior_so,
          FLOOR(EXTRACT(EPOCH FROM (c.order_at - c.prior_at)) / 86400)::int,
          p_winback_gap_days,
          p_winback_gap_days)
    END,
    now()
  FROM classified c;

  GET DIAGNOSTICS v_orders = ROW_COUNT;

  SELECT COALESCE(jsonb_object_agg(cohort, cnt), '{}'::jsonb)
  INTO v_by_cohort
  FROM (SELECT cohort, COUNT(*) AS cnt FROM order_revenue_cohort GROUP BY cohort) t;

  v_result := jsonb_build_object(
    'orders', v_orders,
    'by_cohort', v_by_cohort,
    'new_customers', (SELECT COUNT(*) FROM order_revenue_cohort WHERE is_cohort_entry AND cohort = 'NEW'),
    'winback_entries', (SELECT COUNT(*) FROM order_revenue_cohort WHERE is_cohort_entry AND cohort = 'WINBACK'),
    'params', jsonb_build_object(
      'new_period_days', p_new_period_days,
      'winback_gap_days', p_winback_gap_days,
      'winback_period_days', p_winback_period_days
    ),
    'refreshed_at', now()
  );

  RETURN v_result;
END;
$$;

SELECT refresh_revenue_cohorts();
