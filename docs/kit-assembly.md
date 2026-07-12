# Kit Assembly module (P13) — Phase 1

Zeus is the canonical system for nursing-kit assembly (Fishbowl's BOM/MO
modules are unused). This replaces the SharePoint "Nursing Kit Report"
workbook.

## Where

- UI: `/dashboard/kits` (sidebar "Kit Assembly") — roles: superadmin, admin,
  staff, warehouse (`KITS_API_AUTH_OPTIONS`).
- Ops overlay table: `kit_orders` (migration 045) — one row per `-KIT` SO,
  human-owned fields only: earliest/absolute need-by, transit days, rep,
  table location, kit-list-printed, sub-kit status, notes. Staff-read RLS,
  service-role writes, `updated_by` audit.
- Lib: `src/lib/kits/data.ts` (workbench dataset) + `workdays.ts` (Excel
  WORKDAY-compatible math).
- API: `PATCH /api/kits/[soNumber]` (field updates), `POST /api/kits/import`
  (CSV seeding from the workbook; recognizes its column headers, verifies
  Order# against the Fishbowl cache, reports skips).

## Computed (never entered)

From the fb_* caches, per kit order: school, kit count (kit-master line
qty), line items, pick %, backordered lines (short vs on-hand + open-PO
coverage + earliest ETA, "NO PO" flagged red), actual ship date (shipments
cache), turn time (workdays PO-received → shipped), on-time (shipped ≤
latest ship-by), and the ship window:

```
ship-by = need-by minus transit_days, in workdays  (WORKDAY equivalent)
urgency = overdue / due_today / this_week (≤5 wd) / on_track / no_dates
```

Validated against the workbook: for 138473-KIT (need-by 7/30, transit 3)
Zeus computes earliest-ship 7/27 — matching the sheet's own value. NOTE:
the sheet's "Latest Ship Date" sometimes carries extra buffer beyond
need-by − transit; confirm the exact formula against the live workbook and
calibrate `shipDeadline()` if needed.

## Seeding (Monday)

Open the live workbook sheet → save/copy as CSV → `/dashboard/kits` →
"Import workbook" → paste → Import. Only ops fields import; Fishbowl facts
stay live. Unknown Order#s are reported, not written.

## Phase 2 (planned)

Need-by-driven urgency in the wallboard + Kit Galaxy, floor checkoff flow,
KPI rollups (on-time %, turn time by rep/school), replacing the Backorder
Report workbook with a purchasing exception view.
