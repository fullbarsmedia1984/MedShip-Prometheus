-- Refresh canonical Fishbowl Sales Order views after backfill metadata columns.
-- The original SELECT * views do not automatically expose columns added later.

CREATE OR REPLACE VIEW public.canonical_quotes
WITH (security_invoker = true) AS
SELECT *
FROM public.fb_sales_orders
WHERE canonical_state = 'quote';

CREATE OR REPLACE VIEW public.canonical_orders
WITH (security_invoker = true) AS
SELECT *
FROM public.fb_sales_orders
WHERE canonical_state = 'order';

REVOKE SELECT ON public.canonical_quotes FROM anon;
REVOKE SELECT ON public.canonical_orders FROM anon;
GRANT SELECT ON public.canonical_quotes TO authenticated;
GRANT SELECT ON public.canonical_orders TO authenticated;
