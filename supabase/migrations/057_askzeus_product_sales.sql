-- 057_askzeus_product_sales.sql
--
-- Product-level sales search for AskZeus: aggregate sold line items across all
-- Fishbowl sales orders by keyword. The join + group-by is not expressible
-- through the Supabase client, so per repo convention the SQL lives here as an
-- RPC. Service-role only: AskZeus tools run on the admin client and
-- re-implement the role tiers at the tool layer (rep scoping arrives via
-- p_salespersons).
--
-- Business rules mirror the dashboard revenue metrics in src/lib/data.ts:
-- issued orders only (canonical_state = 'order'), the same test-record
-- exclusion pattern, and the same metric-date fallback chain.

CREATE OR REPLACE FUNCTION askzeus_product_sales(
    p_terms text[],
    p_date_from timestamptz DEFAULT NULL,
    p_date_to timestamptz DEFAULT NULL,
    p_salespersons text[] DEFAULT NULL,
    p_limit integer DEFAULT 25
)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  WITH lines AS (
    SELECT
      i.part_number,
      i.part_description,
      i.quantity,
      i.total_price,
      i.sales_order_number,
      o.customer_name
    FROM fb_sales_order_items i
    JOIN fb_sales_orders o ON o.so_number = i.sales_order_number
    WHERE o.canonical_state = 'order'
      AND NOT (o.so_number ~* '(^|\y)(test|testing|do not use|sample|warehouse)')
      AND NOT (COALESCE(o.customer_name, '') ~* '(^|\y)(test|testing|do not use|sample|warehouse)')
      AND NOT (COALESCE(o.salesperson, '') ~* '(^|\y)(test|testing|do not use|sample|warehouse)')
      AND (p_salespersons IS NULL OR o.salesperson = ANY(p_salespersons))
      AND (
        p_date_from IS NULL
        OR COALESCE(o.date_issued, o.date_completed, o.date_created, o.last_synced_at) >= p_date_from
      )
      AND (
        p_date_to IS NULL
        OR COALESCE(o.date_issued, o.date_completed, o.date_created, o.last_synced_at) < p_date_to + interval '1 day'
      )
      AND EXISTS (
        SELECT 1 FROM unnest(p_terms) AS t(term)
        WHERE i.part_description ILIKE '%' || t.term || '%'
           OR i.part_number ILIKE '%' || t.term || '%'
      )
  ),
  by_sku AS (
    SELECT
      part_number,
      (array_agg(part_description ORDER BY part_description))[1] AS part_description,
      sum(quantity) AS units,
      sum(total_price) AS revenue,
      count(DISTINCT sales_order_number) AS order_count,
      count(DISTINCT customer_name) AS customer_count
    FROM lines
    GROUP BY part_number
  ),
  top_skus AS (
    SELECT * FROM by_sku ORDER BY revenue DESC NULLS LAST LIMIT p_limit
  )
  SELECT jsonb_build_object(
    'skus', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'partNumber', part_number,
        'description', part_description,
        'units', units,
        'revenue', round(revenue::numeric, 2),
        'orderCount', order_count,
        'customerCount', customer_count
      ) ORDER BY revenue DESC NULLS LAST), '[]'::jsonb)
      FROM top_skus
    ),
    'totals', (
      SELECT jsonb_build_object(
        'skuCount', count(*),
        'units', COALESCE(sum(units), 0),
        'revenue', COALESCE(round(sum(revenue)::numeric, 2), 0),
        'orderCount', (SELECT count(DISTINCT sales_order_number) FROM lines),
        'customerCount', (SELECT count(DISTINCT customer_name) FROM lines)
      )
      FROM by_sku
    ),
    'truncated', (SELECT count(*) FROM by_sku) > p_limit
  )
$$;

REVOKE ALL ON FUNCTION askzeus_product_sales(text[], timestamptz, timestamptz, text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION askzeus_product_sales(text[], timestamptz, timestamptz, text[], integer) FROM anon;
REVOKE ALL ON FUNCTION askzeus_product_sales(text[], timestamptz, timestamptz, text[], integer) FROM authenticated;
