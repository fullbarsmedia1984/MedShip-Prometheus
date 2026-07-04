-- Applied to production 2026-07-04 as "incentive_worklist_snapshots" via MCP.
--
-- The quote/void re-hydration (2026-07-03) grew fb_sales_order_items to
-- ~504k rows and gave all 65k SOs customer keys. That pushed
-- v_customer_merge_candidates (pairwise similarity self-join, ~11.5s) and
-- v_incentive_reconciliation_exceptions (full line-item aggregation) past
-- the statement timeout, 500ing the incentives dashboard. These are admin
-- worklists — they don't need live computation. Snapshot both into tables
-- rebuilt by refresh_incentive_worklists() (called from the P8 recompute
-- cron alongside classification), and keep the view names as thin wrappers
-- so the app layer is unchanged.

CREATE TABLE IF NOT EXISTS customer_merge_candidate_snapshot (
  key_a TEXT NOT NULL,
  key_b TEXT NOT NULL,
  name_a TEXT,
  name_b TEXT,
  orders_a BIGINT,
  orders_b BIGINT,
  last_order_a TIMESTAMPTZ,
  last_order_b TIMESTAMPTZ,
  name_similarity REAL,
  street_similarity REAL,
  exact_normalized_match BOOLEAN,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key_a, key_b)
);

CREATE TABLE IF NOT EXISTS incentive_reconciliation_snapshot (
  so_number TEXT PRIMARY KEY,
  customer_name TEXT,
  salesperson TEXT,
  order_at TIMESTAMPTZ,
  total_amount NUMERIC,
  line_item_sum NUMERIC,
  divergence NUMERIC,
  class TEXT,
  rep_display_name TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE customer_merge_candidate_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE incentive_reconciliation_snapshot ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'customer_merge_candidate_snapshot' AND policyname = 'staff read customer_merge_candidate_snapshot'
  ) THEN
    CREATE POLICY "staff read customer_merge_candidate_snapshot" ON customer_merge_candidate_snapshot
      FOR SELECT TO authenticated USING (is_staff_up());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'incentive_reconciliation_snapshot' AND policyname = 'staff read incentive_reconciliation_snapshot'
  ) THEN
    CREATE POLICY "staff read incentive_reconciliation_snapshot" ON incentive_reconciliation_snapshot
      FOR SELECT TO authenticated USING (is_staff_up());
  END IF;
END $$;

CREATE OR REPLACE FUNCTION refresh_incentive_worklists()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidates INT := 0;
  v_exceptions INT := 0;
BEGIN
  TRUNCATE customer_merge_candidate_snapshot;

  INSERT INTO customer_merge_candidate_snapshot (
    key_a, key_b, name_a, name_b, orders_a, orders_b,
    last_order_a, last_order_b, name_similarity, street_similarity,
    exact_normalized_match, computed_at
  )
  WITH customers AS (
    SELECT resolve_canonical_customer_key(business_customer_key) AS ckey,
           MAX(customer_name) AS customer_name,
           LOWER(REGEXP_REPLACE(MAX(customer_name), '[^a-zA-Z0-9]', '', 'g')) AS norm_name,
           MODE() WITHIN GROUP (ORDER BY LEFT(NULLIF(BTRIM(ship_to_postal_code), ''), 5)) AS zip5,
           MODE() WITHIN GROUP (ORDER BY NULLIF(BTRIM(ship_to_street), '')) AS street,
           COUNT(*) FILTER (WHERE canonical_state = 'order') AS order_count,
           MAX(sales_order_metric_at) FILTER (WHERE canonical_state = 'order') AS last_order_at
    FROM fb_sales_orders
    WHERE business_customer_key IS NOT NULL
    GROUP BY 1
  ),
  pairs AS (
    SELECT a.ckey AS key_a, b.ckey AS key_b,
           a.customer_name AS name_a, b.customer_name AS name_b,
           a.order_count AS orders_a, b.order_count AS orders_b,
           a.last_order_at AS last_order_a, b.last_order_at AS last_order_b,
           similarity(LOWER(a.customer_name), LOWER(b.customer_name)) AS name_similarity,
           CASE WHEN a.street IS NOT NULL AND b.street IS NOT NULL
                THEN similarity(LOWER(a.street), LOWER(b.street)) END AS street_similarity,
           a.norm_name = b.norm_name AS exact_normalized_match
    FROM customers a
    JOIN customers b
      ON a.ckey < b.ckey
     AND ((a.norm_name <> '' AND a.norm_name = b.norm_name)
       OR (a.zip5 IS NOT NULL AND a.zip5 = b.zip5
           AND similarity(LOWER(a.customer_name), LOWER(b.customer_name)) >= 0.5))
  )
  SELECT p.key_a, p.key_b, p.name_a, p.name_b, p.orders_a, p.orders_b,
         p.last_order_a, p.last_order_b, p.name_similarity, p.street_similarity,
         p.exact_normalized_match, now()
  FROM pairs p
  WHERE NOT EXISTS (
    SELECT 1 FROM customer_merge_map m
    WHERE (m.duplicate_key = p.key_a AND m.canonical_key = p.key_b)
       OR (m.duplicate_key = p.key_b AND m.canonical_key = p.key_a)
  );

  GET DIAGNOSTICS v_candidates = ROW_COUNT;

  TRUNCATE incentive_reconciliation_snapshot;

  INSERT INTO incentive_reconciliation_snapshot (
    so_number, customer_name, salesperson, order_at, total_amount,
    line_item_sum, divergence, class, rep_display_name, computed_at
  )
  WITH line_sums AS (
    SELECT sales_order_number, SUM(total_price) AS line_sum
    FROM fb_sales_order_items
    GROUP BY 1
  )
  SELECT o.so_number, o.customer_name, o.salesperson,
         o.sales_order_metric_at, o.total_amount,
         COALESCE(ls.line_sum, 0),
         COALESCE(o.total_amount, 0) - COALESCE(ls.line_sum, 0),
         oic.class, oic.rep_display_name, now()
  FROM fb_sales_orders o
  LEFT JOIN line_sums ls ON ls.sales_order_number = o.so_number
  LEFT JOIN order_incentive_class oic ON oic.so_number = o.so_number
  WHERE o.canonical_state = 'order'
    AND ABS(COALESCE(o.total_amount, 0) - COALESCE(ls.line_sum, 0)) > 0.01;

  GET DIAGNOSTICS v_exceptions = ROW_COUNT;

  RETURN jsonb_build_object(
    'merge_candidates', v_candidates,
    'reconciliation_exceptions', v_exceptions,
    'refreshed_at', now()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION refresh_incentive_worklists() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refresh_incentive_worklists() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_incentive_worklists() TO service_role;

-- Swap the heavy views for thin wrappers over the snapshots.
DROP VIEW IF EXISTS v_customer_merge_candidates;
CREATE VIEW v_customer_merge_candidates WITH (security_invoker = true) AS
  SELECT key_a, key_b, name_a, name_b, orders_a, orders_b,
         last_order_a, last_order_b, name_similarity, street_similarity,
         exact_normalized_match
  FROM customer_merge_candidate_snapshot
  ORDER BY exact_normalized_match DESC, name_similarity DESC;

DROP VIEW IF EXISTS v_incentive_reconciliation_exceptions;
CREATE VIEW v_incentive_reconciliation_exceptions WITH (security_invoker = true) AS
  SELECT so_number, customer_name, salesperson, order_at, total_amount,
         line_item_sum, divergence, class, rep_display_name
  FROM incentive_reconciliation_snapshot;

-- Populate immediately so the dashboard recovers without waiting for the cron.
SELECT refresh_incentive_worklists();
