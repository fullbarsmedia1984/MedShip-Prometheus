-- ============================================================
-- Q3 Incentive — Rep Alias Coverage
-- ============================================================
-- The incentive layer reuses fishbowl_salesperson_aliases as the rep
-- alias map (canonical rep identity = COALESCE(sf_user_id, display_name),
-- which collapses multi-alias reps like selliott/Samantha to one rep).
--
-- v_incentive_unmapped_salespersons is the admin worklist: every order
-- salesperson string with no alias row, with in-promo-period exposure.
-- Payout math is BLOCKED while any string with in-period orders is
-- unmapped (enforced in the monthly rollup, migration 027).

ALTER TABLE fishbowl_salesperson_aliases
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE OR REPLACE VIEW v_incentive_unmapped_salespersons
WITH (security_invoker = true) AS
SELECT
  o.salesperson AS fishbowl_salesperson,
  COUNT(*) FILTER (WHERE o.canonical_state = 'order') AS order_count_all_time,
  COUNT(*) FILTER (
    WHERE o.canonical_state = 'order'
      AND o.sales_order_metric_at >= s.promo_start
      AND o.sales_order_metric_at < s.promo_end_exclusive
  ) AS order_count_in_period,
  COALESCE(SUM(COALESCE(o.total_amount, 0)) FILTER (
    WHERE o.canonical_state = 'order'
      AND o.sales_order_metric_at >= s.promo_start
      AND o.sales_order_metric_at < s.promo_end_exclusive
  ), 0) AS amount_in_period,
  MAX(o.sales_order_metric_at) FILTER (WHERE o.canonical_state = 'order') AS last_order_at
FROM fb_sales_orders o
CROSS JOIN get_incentive_settings() s
LEFT JOIN fishbowl_salesperson_aliases a
  ON a.fishbowl_salesperson = o.salesperson
WHERE NULLIF(BTRIM(o.salesperson), '') IS NOT NULL
  AND a.id IS NULL
GROUP BY o.salesperson, s.promo_start, s.promo_end_exclusive
ORDER BY order_count_in_period DESC, order_count_all_time DESC;
