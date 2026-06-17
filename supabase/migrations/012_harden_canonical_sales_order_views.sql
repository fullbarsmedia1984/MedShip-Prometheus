-- Harden canonical Fishbowl Sales Order views so they do not bypass RLS.
-- Supabase/Postgres views created by postgres default to SECURITY DEFINER behavior.

ALTER VIEW public.canonical_quotes SET (security_invoker = true);
ALTER VIEW public.canonical_orders SET (security_invoker = true);

REVOKE SELECT ON public.canonical_quotes FROM anon;
REVOKE SELECT ON public.canonical_orders FROM anon;
REVOKE SELECT ON public.fb_sales_orders FROM anon;
REVOKE SELECT ON public.fb_sales_order_items FROM anon;

GRANT SELECT ON public.canonical_quotes TO authenticated;
GRANT SELECT ON public.canonical_orders TO authenticated;
GRANT SELECT ON public.fb_sales_orders TO authenticated;
GRANT SELECT ON public.fb_sales_order_items TO authenticated;
