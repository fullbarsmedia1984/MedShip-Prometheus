-- Applied to production 2026-07-04 as "winback_opportunities_view" via MCP.
--
-- Winback hunting list: every lapsed customer (365+ days quiet) with their
-- historical value and last-known rep, ranked for outreach. Reads only the
-- precomputed order_revenue_cohort table -- cheap at request time.
CREATE OR REPLACE VIEW v_winback_opportunities WITH (security_invoker = true) AS
WITH last_orders AS (
  SELECT DISTINCT ON (canonical_customer_key)
         canonical_customer_key, so_number, order_at
  FROM order_revenue_cohort
  WHERE canonical_customer_key IS NOT NULL
  ORDER BY canonical_customer_key, order_at DESC, so_number DESC
),
rev AS (
  SELECT canonical_customer_key,
         ROUND(SUM(COALESCE(amount, 0)) FILTER (WHERE order_at > now() - INTERVAL '3 years')::numeric, 2) AS revenue_3yr,
         ROUND(SUM(COALESCE(amount, 0))::numeric, 2) AS revenue_lifetime,
         COUNT(*) AS lifetime_orders
  FROM order_revenue_cohort
  WHERE canonical_customer_key IS NOT NULL
  GROUP BY 1
)
SELECT lo.canonical_customer_key,
       fso.customer_name,
       fso.salesperson AS last_salesperson,
       a.display_name AS last_rep_display_name,
       fso.ship_to_state,
       lo.order_at AS last_order_at,
       lo.so_number AS last_order_so,
       FLOOR(EXTRACT(EPOCH FROM (now() - lo.order_at)) / 86400)::int AS days_lapsed,
       COALESCE(r.revenue_3yr, 0) AS revenue_3yr,
       COALESCE(r.revenue_lifetime, 0) AS revenue_lifetime,
       r.lifetime_orders
FROM last_orders lo
JOIN rev r USING (canonical_customer_key)
JOIN fb_sales_orders fso ON fso.so_number = lo.so_number
LEFT JOIN fishbowl_salesperson_aliases a ON a.fishbowl_salesperson = fso.salesperson
WHERE lo.order_at < now() - INTERVAL '365 days';
