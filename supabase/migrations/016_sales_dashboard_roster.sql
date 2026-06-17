-- ============================================================
-- Sales Dashboard Active Roster
-- Keeps the Sales dashboard focused on the active rep roster while
-- preserving all Fishbowl aliases for audit and mapping visibility.
-- ============================================================

ALTER TABLE fishbowl_salesperson_aliases
  ADD COLUMN IF NOT EXISTS show_on_sales_dashboard BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dashboard_sort_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_fb_salesperson_aliases_dashboard_roster
  ON fishbowl_salesperson_aliases(show_on_sales_dashboard, dashboard_sort_order);

UPDATE fishbowl_salesperson_aliases
SET
  show_on_sales_dashboard = false,
  dashboard_sort_order = NULL
WHERE NOT is_house_account
  AND NOT is_system_alias;

UPDATE fishbowl_salesperson_aliases
SET show_on_sales_dashboard = true,
    dashboard_sort_order = CASE fishbowl_salesperson
      WHEN 'MikeF' THEN 10
      WHEN 'dtorres' THEN 20
      WHEN 'selliott' THEN 30
      WHEN 'Samantha' THEN 31
      WHEN 'svasic' THEN 40
      WHEN 'Leo' THEN 50
      ELSE dashboard_sort_order
    END
WHERE fishbowl_salesperson IN ('MikeF', 'dtorres', 'selliott', 'Samantha', 'svasic', 'Leo');
