-- Reconciled from live DB (Phase 0, PRD §12): applied 2026-06-24 as version
-- 20260624223238 "sales_order_new_recurring_business" via MCP apply_migration,
-- but never committed to the repo. Recorded verbatim for repo/schema parity.
-- Do NOT re-apply to the production project.

-- ============================================================
-- Fishbowl Sales Order New vs Recurring Business Classification
-- ============================================================
-- New Business:
--   An issued Fishbowl Sales Order where the same customer had no prior
--   issued Sales Order in the previous 12 months.
--
-- Recurring Business:
--   An issued Fishbowl Sales Order where the same customer did have a prior
--   issued Sales Order in the previous 12 months.
--
-- Customer identity prefers Fishbowl customer_id, then falls back to a
-- normalized customer_name so the classification remains usable for older
-- cache rows that lack a stable customer id.

ALTER TABLE fb_sales_orders
  ADD COLUMN IF NOT EXISTS sales_order_metric_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS business_customer_key TEXT,
  ADD COLUMN IF NOT EXISTS business_classification TEXT
    CHECK (business_classification IN ('new_business', 'recurring_business')),
  ADD COLUMN IF NOT EXISTS prior_issued_so_number TEXT,
  ADD COLUMN IF NOT EXISTS prior_issued_order_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS business_classified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_fb_so_business_classification
  ON fb_sales_orders(business_classification);

CREATE INDEX IF NOT EXISTS idx_fb_so_business_customer_metric
  ON fb_sales_orders(business_customer_key, sales_order_metric_at DESC)
  WHERE canonical_state = 'order';

CREATE OR REPLACE FUNCTION normalize_fb_so_business_customer_key(
  customer_id_value TEXT,
  customer_name_value TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN NULLIF(BTRIM(customer_id_value), '') IS NOT NULL THEN
      'id:' || BTRIM(customer_id_value)
    WHEN NULLIF(BTRIM(customer_name_value), '') IS NOT NULL THEN
      'name:' || LOWER(REGEXP_REPLACE(BTRIM(customer_name_value), '\s+', ' ', 'g'))
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION set_fb_so_business_classification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prior_order RECORD;
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
    NEW.business_classified_at := now();
    RETURN NEW;
  END IF;

  SELECT so_number, sales_order_metric_at
  INTO prior_order
  FROM fb_sales_orders
  WHERE canonical_state = 'order'
    AND so_number <> NEW.so_number
    AND business_customer_key = NEW.business_customer_key
    AND sales_order_metric_at < NEW.sales_order_metric_at
    AND sales_order_metric_at >= NEW.sales_order_metric_at - INTERVAL '12 months'
  ORDER BY sales_order_metric_at DESC, so_number DESC
  LIMIT 1;

  IF prior_order.so_number IS NULL THEN
    NEW.business_classification := 'new_business';
    NEW.prior_issued_so_number := NULL;
    NEW.prior_issued_order_at := NULL;
  ELSE
    NEW.business_classification := 'recurring_business';
    NEW.prior_issued_so_number := prior_order.so_number;
    NEW.prior_issued_order_at := prior_order.sales_order_metric_at;
  END IF;

  NEW.business_classified_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fb_so_business_classification ON fb_sales_orders;

CREATE TRIGGER trg_fb_so_business_classification
BEFORE INSERT OR UPDATE OF
  canonical_state,
  customer_id,
  customer_name,
  date_issued,
  date_completed,
  date_created
ON fb_sales_orders
FOR EACH ROW
EXECUTE FUNCTION set_fb_so_business_classification();

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

  WITH orders AS (
    SELECT so_number, business_customer_key, sales_order_metric_at
    FROM fb_sales_orders
    WHERE canonical_state = 'order'
      AND business_customer_key IS NOT NULL
      AND sales_order_metric_at IS NOT NULL
  ),
  classified AS (
    SELECT
      current_order.so_number,
      prior_order.so_number AS prior_so_number,
      prior_order.sales_order_metric_at AS prior_order_at
    FROM orders current_order
    LEFT JOIN LATERAL (
      SELECT so_number, sales_order_metric_at
      FROM orders candidate
      WHERE candidate.business_customer_key = current_order.business_customer_key
        AND candidate.sales_order_metric_at < current_order.sales_order_metric_at
        AND candidate.sales_order_metric_at >= current_order.sales_order_metric_at - INTERVAL '12 months'
      ORDER BY candidate.sales_order_metric_at DESC, candidate.so_number DESC
      LIMIT 1
    ) prior_order ON true
  )
  UPDATE fb_sales_orders target
  SET
    business_classification = CASE
      WHEN classified.prior_so_number IS NULL THEN 'new_business'
      ELSE 'recurring_business'
    END,
    prior_issued_so_number = classified.prior_so_number,
    prior_issued_order_at = classified.prior_order_at,
    business_classified_at = now()
  FROM classified
  WHERE target.so_number = classified.so_number;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;

  UPDATE fb_sales_orders
  SET
    business_classification = NULL,
    prior_issued_so_number = NULL,
    prior_issued_order_at = NULL,
    business_classified_at = now()
  WHERE canonical_state <> 'order'
    OR business_customer_key IS NULL
    OR sales_order_metric_at IS NULL;

  RETURN affected_rows;
END;
$$;

SELECT refresh_fb_so_business_classification();
