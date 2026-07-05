-- ============================================================
-- Q3 Incentive — Classification Engine
-- ============================================================
-- Derived, fully-recomputable incentive layer. Built ALONGSIDE the
-- 365-day cohort classification (migrations 018/021) — nothing here
-- touches business_classification or its trigger.
--
-- "New customer" (incentive definition) = first-EVER purchaser on the
-- post-merge canonical customer key; all completed orders within
-- new_window_days (90) of the first order are NEW_WINDOW. A customer
-- whose gap since the previous order is >= win_back_gap_days (365) is
-- a WIN_BACK — tracked, never bonus-eligible.
--
-- Everything is TRUNCATE + rebuilt in one transaction by
-- refresh_incentive_classification(): the running P7 backfill hydrates
-- date_issued and retroactively shifts sales_order_metric_at, so no
-- incremental state can be trusted. ~17k orders — a full rebuild is
-- cheap. Refresh is debounced via incentive_refresh_state.dirty_at
-- (statement-level triggers) + an Inngest cron; never per-row.

-- ------------------------------------------------------------
-- Derived tables
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS customer_first_order (
    canonical_customer_key TEXT PRIMARY KEY,
    first_order_so_number TEXT,
    first_order_at TIMESTAMPTZ,
    new_window_end TIMESTAMPTZ,
    first_order_salesperson TEXT,
    first_order_rep_alias_id UUID,
    first_order_month DATE,           -- America/Chicago month bucket
    is_quote_only BOOLEAN NOT NULL DEFAULT false,
    order_count INT NOT NULL DEFAULT 0,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cfo_first_order_month
  ON customer_first_order(first_order_month);

CREATE TABLE IF NOT EXISTS order_incentive_class (
    so_number TEXT PRIMARY KEY REFERENCES fb_sales_orders(so_number) ON DELETE CASCADE,
    canonical_customer_key TEXT,
    raw_customer_key TEXT,
    order_at TIMESTAMPTZ NOT NULL,
    order_month DATE NOT NULL,        -- America/Chicago month bucket
    salesperson_raw TEXT,
    rep_alias_id UUID,
    rep_key TEXT,                     -- COALESCE(sf_user_id, display_name); NULL when unmapped/no rep
    rep_display_name TEXT,
    rep_unmapped BOOLEAN NOT NULL DEFAULT false,
    amount NUMERIC(14,2),
    net_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    class TEXT NOT NULL CHECK (class IN (
      'NEW_WINDOW', 'RECURRING', 'WIN_BACK',
      'EXCLUDED_HOUSE', 'EXCLUDED_NO_REP', 'EXCLUDED_NEGATIVE'
    )),
    class_reason TEXT NOT NULL,
    prior_order_so_number TEXT,
    prior_order_at TIMESTAMPTZ,
    prior_gap_days INT,
    is_first_order BOOLEAN NOT NULL DEFAULT false,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oic_rep_month ON order_incentive_class(rep_key, order_month);
CREATE INDEX IF NOT EXISTS idx_oic_cust_month ON order_incentive_class(canonical_customer_key, order_month);
CREATE INDEX IF NOT EXISTS idx_oic_class ON order_incentive_class(class);

-- "Ring the bell" dedupe log: one row per canonical customer, ever.
-- The PRIMARY KEY is the dedupe mechanism (insert-on-conflict-do-nothing
-- makes ringing race-safe across concurrent Inngest runs).
CREATE TABLE IF NOT EXISTS incentive_bell_log (
    canonical_key TEXT PRIMARY KEY,
    so_number TEXT,
    rep TEXT,
    institution TEXT,
    amount NUMERIC(14,2),
    rung_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    webhook_sent BOOLEAN NOT NULL DEFAULT false,
    webhook_error TEXT
);

-- Single-row dirty flag: statement-level triggers set dirty_at; the
-- Inngest cron refreshes only when dirty_at > last_refresh_at.
CREATE TABLE IF NOT EXISTS incentive_refresh_state (
    id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    dirty_at TIMESTAMPTZ,
    last_refresh_at TIMESTAMPTZ,
    last_refresh_result JSONB
);

INSERT INTO incentive_refresh_state (id, dirty_at)
VALUES (true, now())
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- RLS (auth read; writes via service role / SECURITY DEFINER only)
-- ------------------------------------------------------------

ALTER TABLE customer_first_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_incentive_class ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_bell_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_refresh_state ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customer_first_order', 'order_incentive_class',
    'incentive_bell_log', 'incentive_refresh_state'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND policyname = 'auth read ' || t
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (true)',
        'auth read ' || t, t
      );
    END IF;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- Dirty-flag statement triggers (O(1) per statement — absorbs the
-- P7 backfill's bulk updates without per-row recompute)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION mark_incentive_dirty()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE incentive_refresh_state SET dirty_at = now() WHERE id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_incentive_dirty_fb_so ON fb_sales_orders;
CREATE TRIGGER trg_incentive_dirty_fb_so
AFTER INSERT OR UPDATE OR DELETE ON fb_sales_orders
FOR EACH STATEMENT EXECUTE FUNCTION mark_incentive_dirty();

DROP TRIGGER IF EXISTS trg_incentive_dirty_merge_map ON customer_merge_map;
CREATE TRIGGER trg_incentive_dirty_merge_map
AFTER INSERT OR UPDATE OR DELETE ON customer_merge_map
FOR EACH STATEMENT EXECUTE FUNCTION mark_incentive_dirty();

DROP TRIGGER IF EXISTS trg_incentive_dirty_aliases ON fishbowl_salesperson_aliases;
CREATE TRIGGER trg_incentive_dirty_aliases
AFTER INSERT OR UPDATE OR DELETE ON fishbowl_salesperson_aliases
FOR EACH STATEMENT EXECUTE FUNCTION mark_incentive_dirty();

-- ------------------------------------------------------------
-- Full deterministic rebuild
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION refresh_incentive_classification()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
  v_customers INT := 0;
  v_quote_only INT := 0;
  v_orders INT := 0;
  v_unmapped_in_period INT := 0;
  v_by_class JSONB;
  v_result JSONB;
BEGIN
  -- Raises on missing/malformed config: refresh refuses to run on bad settings.
  SELECT * INTO STRICT s FROM get_incentive_settings();

  -- 1) First order per canonical customer -------------------------------
  TRUNCATE customer_first_order;

  INSERT INTO customer_first_order (
    canonical_customer_key, first_order_so_number, first_order_at,
    new_window_end, first_order_salesperson, first_order_rep_alias_id,
    first_order_month, is_quote_only, order_count, computed_at
  )
  WITH src AS (
    SELECT
      so_number,
      resolve_canonical_customer_key(business_customer_key) AS ckey,
      sales_order_metric_at AS order_at,
      salesperson
    FROM fb_sales_orders
    WHERE canonical_state = 'order'
      AND business_customer_key IS NOT NULL
      AND sales_order_metric_at IS NOT NULL
  ),
  ranked AS (
    SELECT
      src.*,
      ROW_NUMBER() OVER (PARTITION BY ckey ORDER BY order_at ASC, so_number ASC) AS rn,
      COUNT(*) OVER (PARTITION BY ckey) AS order_count
    FROM src
  )
  SELECT
    r.ckey,
    r.so_number,
    r.order_at,
    r.order_at + make_interval(days => s.new_window_days),
    r.salesperson,
    a.id,
    (date_trunc('month', r.order_at AT TIME ZONE 'America/Chicago'))::date,
    false,
    r.order_count,
    now()
  FROM ranked r
  LEFT JOIN fishbowl_salesperson_aliases a
    ON a.fishbowl_salesperson = r.salesperson
  WHERE r.rn = 1;

  GET DIAGNOSTICS v_customers = ROW_COUNT;

  -- Quote-only customers (never purchased): tracked, no window.
  INSERT INTO customer_first_order (canonical_customer_key, is_quote_only, order_count, computed_at)
  SELECT DISTINCT
    resolve_canonical_customer_key(business_customer_key), true, 0, now()
  FROM fb_sales_orders
  WHERE canonical_state = 'quote'
    AND business_customer_key IS NOT NULL
  ON CONFLICT (canonical_customer_key) DO NOTHING;

  GET DIAGNOSTICS v_quote_only = ROW_COUNT;

  -- 2) Per-order incentive classification -------------------------------
  TRUNCATE order_incentive_class;

  INSERT INTO order_incentive_class (
    so_number, canonical_customer_key, raw_customer_key, order_at, order_month,
    salesperson_raw, rep_alias_id, rep_key, rep_display_name, rep_unmapped,
    amount, net_amount, class, class_reason,
    prior_order_so_number, prior_order_at, prior_gap_days, is_first_order, computed_at
  )
  WITH src AS (
    SELECT
      so_number,
      business_customer_key AS raw_key,
      resolve_canonical_customer_key(business_customer_key) AS ckey,
      sales_order_metric_at AS order_at,
      total_amount,
      salesperson
    FROM fb_sales_orders
    WHERE canonical_state = 'order'
      AND sales_order_metric_at IS NOT NULL
  ),
  seq AS (
    SELECT
      src.*,
      LAG(order_at) OVER w AS prior_order_at,
      LAG(so_number) OVER w AS prior_so_number
    FROM src
    -- NULL-ckey orders get a unique partition so they never see a "prior".
    WINDOW w AS (
      PARTITION BY COALESCE(ckey, 'so:' || so_number)
      ORDER BY order_at ASC, so_number ASC
    )
  )
  SELECT
    q.so_number,
    q.ckey,
    q.raw_key,
    q.order_at,
    (date_trunc('month', q.order_at AT TIME ZONE 'America/Chicago'))::date,
    q.salesperson,
    a.id,
    CASE WHEN a.id IS NOT NULL THEN COALESCE(a.sf_user_id, a.display_name) END,
    a.display_name,
    (NULLIF(BTRIM(q.salesperson), '') IS NOT NULL AND a.id IS NULL),
    q.total_amount,
    COALESCE(q.total_amount, 0),
    cls.class,
    cls.class_reason,
    q.prior_so_number,
    q.prior_order_at,
    CASE WHEN q.prior_order_at IS NOT NULL
         THEN FLOOR(EXTRACT(EPOCH FROM (q.order_at - q.prior_order_at)) / 86400)::int
    END,
    COALESCE(cfo.first_order_so_number = q.so_number, false),
    now()
  FROM seq q
  LEFT JOIN fishbowl_salesperson_aliases a
    ON a.fishbowl_salesperson = q.salesperson
  LEFT JOIN customer_first_order cfo
    ON cfo.canonical_customer_key = q.ckey
  CROSS JOIN LATERAL (
    SELECT CASE
      -- Strict precedence; rep_unmapped never changes class (it blocks
      -- payout at the rollup instead).
      WHEN NULLIF(BTRIM(q.salesperson), '') IS NULL THEN 'EXCLUDED_NO_REP'
      WHEN COALESCE(a.is_house_account, false) OR COALESCE(a.is_system_alias, false) THEN 'EXCLUDED_HOUSE'
      WHEN q.total_amount < 0 THEN 'EXCLUDED_NEGATIVE'
      WHEN q.prior_order_at IS NOT NULL
           AND q.order_at - q.prior_order_at >= make_interval(days => s.win_back_gap_days) THEN 'WIN_BACK'
      WHEN cfo.first_order_at IS NOT NULL
           AND q.order_at >= cfo.first_order_at
           AND q.order_at < cfo.new_window_end THEN 'NEW_WINDOW'
      ELSE 'RECURRING'
    END AS class
  ) pre
  CROSS JOIN LATERAL (
    SELECT
      pre.class,
      CASE pre.class
        WHEN 'EXCLUDED_NO_REP' THEN
          'EXCLUDED_NO_REP: salesperson is null/blank'
        WHEN 'EXCLUDED_HOUSE' THEN
          format('EXCLUDED_HOUSE: salesperson "%s" flagged %s', q.salesperson,
            CASE WHEN COALESCE(a.is_house_account, false) THEN 'is_house_account' ELSE 'is_system_alias' END)
        WHEN 'EXCLUDED_NEGATIVE' THEN
          format('EXCLUDED_NEGATIVE: total_amount %s; nets against %s eligible revenue for %s',
            q.total_amount,
            to_char((date_trunc('month', q.order_at AT TIME ZONE 'America/Chicago'))::date, 'YYYY-MM'),
            COALESCE(q.ckey, '(no customer identity)'))
        WHEN 'WIN_BACK' THEN
          format('WIN_BACK: prior order SO %s at %s, gap %s days >= %s-day lapse; excluded from NEW_WINDOW per PRD',
            q.prior_so_number,
            to_char(q.prior_order_at, 'YYYY-MM-DD'),
            FLOOR(EXTRACT(EPOCH FROM (q.order_at - q.prior_order_at)) / 86400)::int,
            s.win_back_gap_days)
        WHEN 'NEW_WINDOW' THEN
          format('NEW_WINDOW: first order SO %s at %s; within %s-day window ending %s',
            cfo.first_order_so_number,
            to_char(cfo.first_order_at, 'YYYY-MM-DD'),
            s.new_window_days,
            to_char(cfo.new_window_end, 'YYYY-MM-DD'))
        ELSE
          CASE
            WHEN q.ckey IS NULL THEN
              'RECURRING: no customer identity (business_customer_key is null); cannot be NEW_WINDOW'
            ELSE
              format('RECURRING: first order SO %s at %s; %s-day new-customer window ended %s%s',
                cfo.first_order_so_number,
                to_char(cfo.first_order_at, 'YYYY-MM-DD'),
                s.new_window_days,
                to_char(cfo.new_window_end, 'YYYY-MM-DD'),
                CASE WHEN q.prior_order_at IS NOT NULL
                     THEN format('; prior order SO %s at %s, gap %s days',
                            q.prior_so_number,
                            to_char(q.prior_order_at, 'YYYY-MM-DD'),
                            FLOOR(EXTRACT(EPOCH FROM (q.order_at - q.prior_order_at)) / 86400)::int)
                     ELSE ''
                END)
          END
      END AS class_reason
  ) cls;

  GET DIAGNOSTICS v_orders = ROW_COUNT;

  -- 3) Result summary ----------------------------------------------------
  SELECT COALESCE(jsonb_object_agg(class, cnt), '{}'::jsonb)
  INTO v_by_class
  FROM (SELECT class, COUNT(*) AS cnt FROM order_incentive_class GROUP BY class) t;

  SELECT COUNT(DISTINCT salesperson_raw)
  INTO v_unmapped_in_period
  FROM order_incentive_class
  WHERE rep_unmapped
    AND order_at >= s.promo_start
    AND order_at < s.promo_end_exclusive;

  v_result := jsonb_build_object(
    'orders', v_orders,
    'customers', v_customers,
    'quote_only_customers', v_quote_only,
    'by_class', v_by_class,
    'unmapped_reps_in_period', v_unmapped_in_period,
    'refreshed_at', now()
  );

  UPDATE incentive_refresh_state
  SET last_refresh_at = now(), last_refresh_result = v_result
  WHERE id;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION refresh_incentive_classification() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refresh_incentive_classification() FROM authenticated;
GRANT EXECUTE ON FUNCTION refresh_incentive_classification() TO service_role;

SELECT refresh_incentive_classification();
