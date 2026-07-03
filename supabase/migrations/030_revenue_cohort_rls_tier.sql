-- order_revenue_cohort was created after the Phase 2 flat-policy sweep, so
-- its "any authenticated user" read policy survived. Revenue cohort rows
-- carry per-order/per-customer revenue for the whole business - staff-tier
-- data per the PRD matrix. Replace the flat policy with the role-tiered one.

DROP POLICY IF EXISTS "auth read order_revenue_cohort" ON order_revenue_cohort;

CREATE POLICY "staff read order_revenue_cohort" ON order_revenue_cohort
    FOR SELECT TO authenticated
    USING (is_staff_up());
