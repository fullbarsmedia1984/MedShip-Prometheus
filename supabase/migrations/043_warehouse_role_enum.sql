-- Warehouse / Logistics role (PRD role model extension, owner request
-- 2026-07-10): access to the packaging estimator, kanban boards, supplier
-- catalog, and the warehouse wallboard. Enum value only — Postgres forbids
-- using a new enum value in the transaction that adds it, so the trigger
-- update ships separately in 044.

ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'warehouse';
