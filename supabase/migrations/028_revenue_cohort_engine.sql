-- ============================================================
-- Revenue Cohort Engine — NEW / WINBACK / RECURRING
-- ============================================================
-- Refined "new business" definition for reporting and the future
-- compensation model (per Steven, 2026-07-03):
--
--   NEW       — the customer has never bought from us before, EVER.
--               The first-ever order opens a NEW period; every order in
--               the following 365 days is NEW-cohort revenue.
--   WINBACK   — the customer HAS bought before, but not in >= 365 days.
--               The returning order opens a WINBACK period; every order
--               in the following 365 days is WINBACK-cohort revenue.
--               A customer can re-enter WINBACK on every >= 365-day lapse.
--   RECURRING — everything else (order falls outside any active NEW or
--               WINBACK period).
--
-- Design notes:
--   * Customer identity = resolve_canonical_customer_key() (merge-map
--     aware), order date = sales_order_metric_at (issue date preferred,
--     per Dan's D5), months bucketed America/Chicago — identical basis
--     to the incentive engine (026) so the two layers never disagree
--     about who bought what when.
--   * Lapse threshold is >= 365 days, matching the incentive engine's
--     WIN_BACK test, so an SO is never WIN_BACK there but RECURRING here.
--   * The NEW period length (365 days) mirrors the existing 365-day
--     cohort convention (migration 021) and the WINBACK period length.
--     All three durations are function parameters with 365-day defaults.
--   * This is a revenue REPORTING layer: house-account, rep-less and
--     negative orders are all cohorted (they are still revenue events).
--     Commission eligibility stays in order_incentive_class.
--   * Fully deterministic TRUNCATE + rebuild, same as 026, because the
--     P7 sync retroactively shifts metric dates. Refresh rides the same
--     incentive_refresh_state dirty flag / P8 cron.

-- ------------------------------------------------------------
-- Derived table
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS order_revenue_cohort (
    so_number TEXT PRIMARY KEY REFERENCES fb_sales_orders(so_number) ON DELETE CASCADE,
    canonical_customer_key TEXT,
    raw_customer_key TEXT,
    order_at TIMESTAMPTZ NOT NULL,
    order_month DATE NOT NULL,        -- America/Chicago month bucket
    amount NUMERIC(14,2),
    cohort TEXT NOT NULL CHECK (cohort IN ('NEW', 'WINBACK', 'RECURRING')),
    is_cohort_entry BOOLEAN NOT NULL DEFAULT false,  -- this SO opened the period
    cohort_entered_at TIMESTAMPTZ NOT NULL,
    cohort_entry_so TEXT NOT NULL,
    cohort_expires_at TIMESTAMPTZ,    -- NULL for RECURRING
    prior_order_so_number TEXT,
    prior_order_at TIMESTAMPTZ,
    prior_gap_days INT,
    cohort_reason TEXT NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orc_cohort_month ON order_revenue_cohort(cohort, order_month);
CREATE INDEX IF NOT EXISTS idx_orc_cust_at ON order_revenue_cohort(canonical_customer_key, order_at);

ALTER TABLE order_revenue_cohort ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'order_revenue_cohort'
      AND policyname = 'auth read order_revenue_cohort'
  ) THEN
    CREATE POLICY "auth read order_revenue_cohort" ON order_revenue_cohort
      FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ------------------------------------------------------------
-- Full deterministic rebuild
-- ------------------------------------------------------------

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
    -- NULL-ckey orders get a unique partition so they never see a "prior".
    WINDOW w AS (
      PARTITION BY COALESCE(ckey, 'so:' || so_number)
      ORDER BY order_at ASC, so_number ASC
    )
  ),
  entries AS (
    -- Period-opening orders: the first-ever order opens NEW; any order
    -- arriving after a >= gap-days lapse opens WINBACK. These are the only
    -- two ways a period starts, and rn = 1 guarantees every order belongs
    -- to some period.
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
        -- Do NOT phrase period_start as "first bought": for a customer whose
        -- most recent period was WINBACK, period_start is the winback date.
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

REVOKE EXECUTE ON FUNCTION refresh_revenue_cohorts(INT, INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refresh_revenue_cohorts(INT, INT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION refresh_revenue_cohorts(INT, INT, INT) TO service_role;

-- ------------------------------------------------------------
-- Reporting views
-- ------------------------------------------------------------

-- Monthly revenue by cohort (America/Chicago months).
CREATE OR REPLACE VIEW v_revenue_cohort_monthly
WITH (security_invoker = true) AS
SELECT
  order_month,
  cohort,
  COUNT(*) AS orders,
  COUNT(DISTINCT canonical_customer_key) AS customers,
  COUNT(*) FILTER (WHERE is_cohort_entry) AS cohort_entries,
  SUM(COALESCE(amount, 0)) AS revenue
FROM order_revenue_cohort
GROUP BY order_month, cohort;

-- Where each customer stands TODAY: inside a NEW or WINBACK period,
-- actively RECURRING, or LAPSED (winback-eligible: no purchase in >= 365 days).
CREATE OR REPLACE VIEW v_customer_cohort_current
WITH (security_invoker = true) AS
SELECT DISTINCT ON (canonical_customer_key)
  canonical_customer_key,
  so_number AS last_so_number,
  order_at AS last_order_at,
  cohort AS last_order_cohort,
  cohort_entered_at,
  cohort_entry_so,
  cohort_expires_at,
  CASE
    WHEN cohort IN ('NEW', 'WINBACK') AND now() < cohort_expires_at THEN cohort
    WHEN now() - order_at < interval '365 days' THEN 'RECURRING'
    ELSE 'LAPSED'
  END AS current_cohort
FROM order_revenue_cohort
WHERE canonical_customer_key IS NOT NULL
ORDER BY canonical_customer_key, order_at DESC, so_number DESC;

-- Initial build.
SELECT refresh_revenue_cohorts();
