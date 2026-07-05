-- Phase 4 rep experience (PRD §7.2, decision 2).
-- Adds the canonical Fishbowl user id to the alias table and row-scopes
-- canonical sales orders for sales reps: a rep sees only orders whose
-- salesperson alias resolves to them; a sales manager sees all.

ALTER TABLE fishbowl_salesperson_aliases
    ADD COLUMN IF NOT EXISTS fishbowl_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_fb_aliases_fishbowl_user
    ON fishbowl_salesperson_aliases(fishbowl_user_id)
    WHERE fishbowl_user_id IS NOT NULL;

-- Aliases belonging to the calling user. Fishbowl user id is the canonical
-- rep identity (decision 2); sf_user_id is the transitional fallback until
-- Fishbowl ids are populated on both profiles and aliases. SECURITY DEFINER
-- so rep policies can resolve aliases without granting reps read access to
-- the aliases table itself.
CREATE OR REPLACE FUNCTION current_rep_aliases()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(array_agg(a.fishbowl_salesperson), '{}')
  FROM public.profiles p
  JOIN public.fishbowl_salesperson_aliases a
    ON (p.fishbowl_user_id IS NOT NULL AND a.fishbowl_user_id = p.fishbowl_user_id)
    OR (p.sf_user_id IS NOT NULL AND a.sf_user_id = p.sf_user_id)
  WHERE p.id = (SELECT auth.uid())
$$;

-- Rep row-scoping on canonical sales orders. The security_invoker views
-- canonical_quotes / canonical_orders inherit these policies. Combines with
-- the existing staff+ policy permissively.
CREATE POLICY "rep read own fb_sales_orders" ON fb_sales_orders
    FOR SELECT TO authenticated
    USING (
        jwt_app_role() = 'sales_manager'
        OR (
            jwt_app_role() = 'sales_rep'
            AND salesperson = ANY (current_rep_aliases())
        )
    );

CREATE POLICY "rep read own fb_sales_order_items" ON fb_sales_order_items
    FOR SELECT TO authenticated
    USING (
        jwt_app_role() = 'sales_manager'
        OR (
            jwt_app_role() = 'sales_rep'
            AND EXISTS (
                SELECT 1 FROM fb_sales_orders o
                WHERE o.so_number = fb_sales_order_items.sales_order_number
                  AND o.salesperson = ANY (current_rep_aliases())
            )
        )
    );
