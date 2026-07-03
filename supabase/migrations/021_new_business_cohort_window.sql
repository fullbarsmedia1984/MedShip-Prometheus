-- Reconciled from live DB (Phase 0, PRD §12): applied 2026-07-01 as version
-- 20260701173539 "new_business_cohort_window" via MCP apply_migration,
-- but never committed to the repo. Recorded verbatim for repo/schema parity.
-- Do NOT re-apply to the production project.

-- ============================================================
-- Fishbowl Sales Order New Business Cohort Window
-- ============================================================
-- New Business:
--   The first issued Fishbowl Sales Order after a customer has had no
--   issued orders in the prior 365 days starts a new-business cohort.
--   All issued orders from that same customer inside the following
--   365-day cohort window are also classified as new_business.
--
-- Recurring Business:
--   Orders after the active new-business cohort window are recurring,
--   provided the customer has still ordered inside the prior 365 days.
--
-- If a customer goes more than 365 days without an issued order, the next
-- issued order starts a fresh new-business cohort.

ALTER TABLE fb_sales_orders
  ADD COLUMN IF NOT EXISTS new_business_cohort_so_number TEXT,
  ADD COLUMN IF NOT EXISTS new_business_cohort_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_fb_so_business_cohort
  ON fb_sales_orders(new_business_cohort_started_at DESC)
  WHERE canonical_state = 'order';

CREATE OR REPLACE FUNCTION set_fb_so_business_classification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior_order RECORD;
  prior_cohort_started_at TIMESTAMPTZ;
  prior_cohort_so_number TEXT;
BEGIN
  NEW.sales_order_metric_at := COALESCE(NEW.date_issued, NEW.date_completed, NEW.date_created);
  NEW.business_customer_key := normalize_fb_so_business_customer_key(NEW.customer_id, NEW.customer_name);

  IF NEW.canonical_state <> 'order'
    OR NEW.sales_order_metric_at IS NULL
    OR NEW.business_customer_key IS NULL
  THEN
    NEW.business_classification := NULL;
    NEW.prior_issued_so_number := NULL;
    NEW.prior_issued_order_at := NULL;
    NEW.new_business_cohort_so_number := NULL;
    NEW.new_business_cohort_started_at := NULL;
    NEW.business_classified_at := now();
    RETURN NEW;
  END IF;

  SELECT
    so_number,
    sales_order_metric_at,
    business_classification,
    new_business_cohort_so_number,
    new_business_cohort_started_at
  INTO prior_order
  FROM fb_sales_orders
  WHERE canonical_state = 'order'
    AND so_number <> NEW.so_number
    AND business_customer_key = NEW.business_customer_key
    AND sales_order_metric_at < NEW.sales_order_metric_at
  ORDER BY sales_order_metric_at DESC, so_number DESC
  LIMIT 1;

  IF prior_order.so_number IS NULL
    OR prior_order.sales_order_metric_at < NEW.sales_order_metric_at - INTERVAL '365 days'
  THEN
    NEW.business_classification := 'new_business';
    NEW.prior_issued_so_number := NULL;
    NEW.prior_issued_order_at := NULL;
    NEW.new_business_cohort_so_number := NEW.so_number;
    NEW.new_business_cohort_started_at := NEW.sales_order_metric_at;
    NEW.business_classified_at := now();
    RETURN NEW;
  END IF;

  prior_cohort_started_at := COALESCE(
    prior_order.new_business_cohort_started_at,
    CASE
      WHEN prior_order.business_classification = 'new_business' THEN prior_order.sales_order_metric_at
      ELSE NULL
    END
  );
  prior_cohort_so_number := COALESCE(
    prior_order.new_business_cohort_so_number,
    CASE
      WHEN prior_order.business_classification = 'new_business' THEN prior_order.so_number
      ELSE NULL
    END
  );

  NEW.prior_issued_so_number := prior_order.so_number;
  NEW.prior_issued_order_at := prior_order.sales_order_metric_at;

  IF prior_cohort_started_at IS NOT NULL
    AND NEW.sales_order_metric_at < prior_cohort_started_at + INTERVAL '365 days'
  THEN
    NEW.business_classification := 'new_business';
    NEW.new_business_cohort_so_number := prior_cohort_so_number;
    NEW.new_business_cohort_started_at := prior_cohort_started_at;
  ELSE
    NEW.business_classification := 'recurring_business';
    NEW.new_business_cohort_so_number := prior_cohort_so_number;
    NEW.new_business_cohort_started_at := prior_cohort_started_at;
  END IF;

  NEW.business_classified_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_fb_so_business_classification()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  affected_rows INTEGER := 0;
BEGIN
  UPDATE fb_sales_orders
  SET
    sales_order_metric_at = COALESCE(date_issued, date_completed, date_created),
    business_customer_key = normalize_fb_so_business_customer_key(customer_id, customer_name);

  WITH RECURSIVE orders AS (
    SELECT
      so_number,
      business_customer_key,
      sales_order_metric_at,
      ROW_NUMBER() OVER (
        PARTITION BY business_customer_key
        ORDER BY sales_order_metric_at ASC, so_number ASC
      ) AS rn
    FROM fb_sales_orders
    WHERE canonical_state = 'order'
      AND business_customer_key IS NOT NULL
      AND sales_order_metric_at IS NOT NULL
  ),
  classified AS (
    SELECT
      so_number,
      business_customer_key,
      sales_order_metric_at,
      rn,
      'new_business'::TEXT AS business_classification,
      NULL::TEXT AS prior_issued_so_number,
      NULL::TIMESTAMPTZ AS prior_issued_order_at,
      so_number AS new_business_cohort_so_number,
      sales_order_metric_at AS new_business_cohort_started_at
    FROM orders
    WHERE rn = 1

    UNION ALL

    SELECT
      current_order.so_number,
      current_order.business_customer_key,
      current_order.sales_order_metric_at,
      current_order.rn,
      CASE
        WHEN previous_order.sales_order_metric_at < current_order.sales_order_metric_at - INTERVAL '365 days' THEN 'new_business'
        WHEN current_order.sales_order_metric_at < previous_order.new_business_cohort_started_at + INTERVAL '365 days' THEN 'new_business'
        ELSE 'recurring_business'
      END AS business_classification,
      previous_order.so_number AS prior_issued_so_number,
      previous_order.sales_order_metric_at AS prior_issued_order_at,
      CASE
        WHEN previous_order.sales_order_metric_at < current_order.sales_order_metric_at - INTERVAL '365 days' THEN current_order.so_number
        ELSE previous_order.new_business_cohort_so_number
      END AS new_business_cohort_so_number,
      CASE
        WHEN previous_order.sales_order_metric_at < current_order.sales_order_metric_at - INTERVAL '365 days' THEN current_order.sales_order_metric_at
        ELSE previous_order.new_business_cohort_started_at
      END AS new_business_cohort_started_at
    FROM classified previous_order
    JOIN orders current_order
      ON current_order.business_customer_key = previous_order.business_customer_key
     AND current_order.rn = previous_order.rn + 1
  )
  UPDATE fb_sales_orders target
  SET
    business_classification = classified.business_classification,
    prior_issued_so_number = classified.prior_issued_so_number,
    prior_issued_order_at = classified.prior_issued_order_at,
    new_business_cohort_so_number = classified.new_business_cohort_so_number,
    new_business_cohort_started_at = classified.new_business_cohort_started_at,
    business_classified_at = now()
  FROM classified
  WHERE target.so_number = classified.so_number;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  UPDATE fb_sales_orders
  SET
    business_classification = NULL,
    prior_issued_so_number = NULL,
    prior_issued_order_at = NULL,
    new_business_cohort_so_number = NULL,
    new_business_cohort_started_at = NULL,
    business_classified_at = now()
  WHERE canonical_state <> 'order'
    OR business_customer_key IS NULL
    OR sales_order_metric_at IS NULL;

  RETURN affected_rows;
END;
$$;

SELECT refresh_fb_so_business_classification();
