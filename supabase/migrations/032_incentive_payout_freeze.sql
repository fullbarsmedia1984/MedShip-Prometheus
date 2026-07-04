-- Applied to production 2026-07-04 as "incentive_payout_freeze" via MCP.
--
-- Payout freeze (Steven, 2026-07-04): finance pays from an immutable
-- month-end snapshot, not live numbers. Live tables keep moving as late
-- issue dates / credits / merges arrive; frozen months surface differences
-- as VARIANCE instead of silently restating paid commissions.

CREATE TABLE IF NOT EXISTS incentive_payout_snapshot (
  month DATE NOT NULL,
  rep_key TEXT NOT NULL,
  rep_display_name TEXT,
  enrollments INT NOT NULL,
  enrollment_gate INT NOT NULL,
  qualifies BOOLEAN NOT NULL,
  order_count INT NOT NULL,
  new_window_order_count INT NOT NULL,
  attributed_revenue NUMERIC NOT NULL,
  new_customer_revenue_gross NUMERIC NOT NULL,
  net_new_customer_revenue NUMERIC NOT NULL,
  win_back_revenue NUMERIC NOT NULL,
  base_commission NUMERIC NOT NULL,
  bonus_commission NUMERIC NOT NULL,
  projected_total NUMERIC NOT NULL,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  frozen_by TEXT,
  PRIMARY KEY (month, rep_key)
);

ALTER TABLE incentive_payout_snapshot ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'incentive_payout_snapshot' AND policyname = 'staff read incentive_payout_snapshot'
  ) THEN
    CREATE POLICY "staff read incentive_payout_snapshot" ON incentive_payout_snapshot
      FOR SELECT TO authenticated USING (is_staff_up());
  END IF;
END $$;

-- Freeze one promo month. Fail-loud by design:
--  * refuses months that are not over yet
--  * refuses to double-freeze (finance numbers are immutable) unless p_force
--  * refuses while any rep-month row is payout-blocked (NULL commissions
--    from unmapped salespersons) — resolve aliases first, then freeze
CREATE OR REPLACE FUNCTION freeze_incentive_month(p_month DATE, p_frozen_by TEXT DEFAULT NULL, p_force BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month DATE := date_trunc('month', p_month)::date;
  v_month_end_chicago TIMESTAMPTZ := ((v_month + INTERVAL '1 month')::date::text || ' 00:00:00')::timestamp AT TIME ZONE 'America/Chicago';
  v_rows INT := 0;
  v_blocked INT := 0;
BEGIN
  IF now() < v_month_end_chicago THEN
    RAISE EXCEPTION 'Cannot freeze %: the month is not over in America/Chicago yet', v_month;
  END IF;

  IF EXISTS (SELECT 1 FROM incentive_payout_snapshot WHERE month = v_month) THEN
    IF NOT p_force THEN
      RAISE EXCEPTION 'Month % is already frozen; refusing to overwrite paid figures without p_force', v_month;
    END IF;
    DELETE FROM incentive_payout_snapshot WHERE month = v_month;
  END IF;

  SELECT COUNT(*) INTO v_blocked
  FROM v_incentive_rep_month
  WHERE month = v_month AND blocking_unmapped_count > 0;

  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'Cannot freeze %: % rep rows are payout-blocked by unmapped salespersons — resolve aliases first', v_month, v_blocked;
  END IF;

  INSERT INTO incentive_payout_snapshot (
    month, rep_key, rep_display_name, enrollments, enrollment_gate, qualifies,
    order_count, new_window_order_count, attributed_revenue,
    new_customer_revenue_gross, net_new_customer_revenue, win_back_revenue,
    base_commission, bonus_commission, projected_total, frozen_at, frozen_by
  )
  SELECT month, rep_key, rep_display_name, enrollments, enrollment_gate, qualifies,
         order_count, new_window_order_count, attributed_revenue,
         new_customer_revenue_gross, net_new_customer_revenue, win_back_revenue,
         COALESCE(base_commission, 0), COALESCE(bonus_commission, 0),
         COALESCE(projected_total, 0), now(), p_frozen_by
  FROM v_incentive_rep_month
  WHERE month = v_month;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'month', v_month,
    'reps_frozen', v_rows,
    'total_commission', (SELECT COALESCE(SUM(projected_total), 0) FROM incentive_payout_snapshot WHERE month = v_month),
    'frozen_at', now(),
    'frozen_by', p_frozen_by
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION freeze_incentive_month(DATE, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION freeze_incentive_month(DATE, TEXT, BOOLEAN) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION freeze_incentive_month(DATE, TEXT, BOOLEAN) TO service_role;

-- Frozen vs live, per rep-month: what changed since finance paid.
CREATE OR REPLACE VIEW v_incentive_payout_variance WITH (security_invoker = true) AS
SELECT
  s.month,
  s.rep_key,
  COALESCE(s.rep_display_name, l.rep_display_name) AS rep_display_name,
  s.frozen_at,
  s.projected_total AS frozen_total,
  COALESCE(l.projected_total, 0) AS live_total,
  COALESCE(l.projected_total, 0) - s.projected_total AS variance,
  s.enrollments AS frozen_enrollments,
  COALESCE(l.enrollments, 0) AS live_enrollments,
  s.qualifies AS frozen_qualifies,
  COALESCE(l.qualifies, false) AS live_qualifies,
  (l.rep_key IS NULL) AS rep_gone_from_live,
  COALESCE(l.blocking_unmapped_count, 0) > 0 AS live_blocked
FROM incentive_payout_snapshot s
LEFT JOIN v_incentive_rep_month l ON l.month = s.month AND l.rep_key = s.rep_key;
