-- ============================================================
-- Estimator dims work queue
-- Parts ordered in the trailing 12 months that still have no
-- trusted dims (neither human-verified nor catalog-backfilled),
-- ranked by how often they appear on SO lines. Feeds the
-- "Dims queue" tab in the estimator admin so staff measure the
-- highest-velocity gaps first.
-- security_invoker so direct PostgREST access respects the
-- role-tiered RLS on the underlying tables.
-- ============================================================

CREATE OR REPLACE VIEW estimator_dims_queue
WITH (security_invoker = on) AS
SELECT
  i.part_number,
  max(i.part_description) AS part_description,
  count(*) AS line_count_12mo,
  sum(i.quantity) AS total_qty_12mo,
  max(o.date_issued) AS last_ordered_at
FROM fb_sales_order_items i
JOIN fb_sales_orders o ON o.so_number = i.sales_order_number
WHERE o.date_issued >= now() - interval '12 months'
  AND i.part_number IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM item_dims_verified v
    WHERE v.fishbowl_part_number = i.part_number
  )
  AND NOT EXISTS (
    SELECT 1 FROM item_dims_catalog c
    WHERE c.fishbowl_part_number = i.part_number
  )
GROUP BY i.part_number;

COMMENT ON VIEW estimator_dims_queue IS
  'Missing-dims work queue: parts ordered in the last 12 months with no verified or catalog dims, for ranked manual entry';
