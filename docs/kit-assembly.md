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
  service-role writes, and latest-updater attribution in `updated_by`.
- Lib: `src/lib/kits/data.ts` (workbench dataset) + `workdays.ts` (Excel
  WORKDAY-compatible math).
- API: `PATCH /api/kits/[soNumber]` (field updates), `POST /api/kits/import`
  (CSV/Excel-paste seeding from the workbook; deterministic preview first,
  digest-confirmed apply second, exact column aliases, Fishbowl status checks,
  and immutable audit rows for applied imports).

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

Confirmed business rule on 2026-07-13:

```
latest ship date = WORKDAY(Absolute Need By, -Days In Transit)
```

Saturday and Sunday are skipped; there is no additional two-day buffer. For
example, an Absolute Need By date of Monday 2026-08-10 and two transit days
produces Thursday 2026-08-06. Zeus's `shipDeadline()` already implements this
rule. The live workbook's current Latest Ship Date formula subtracts two extra
workdays (`WORKDAY(absolute_need_by, -transit_days-2)`) and is not the rule to
copy into Zeus.

## Seeding (Monday)

Open the live workbook sheet → save as CSV or copy the table →
`/dashboard/kits` → "Import workbook" → paste → **Preview**. Review eligible,
new, changed, unchanged, needs-dates, Estimate, historical, and unknown counts.
Apply is enabled only after a clean preview; it requires that preview's digest,
so a live-state change forces a new preview.

Blank or missing optional cells preserve existing Zeus values. The importer
maps only the exact `Notes` header; `Backorder Items / Sub Notes` is not a Notes
alias. Closed/shipped history is excluded using current Fishbowl status, not
Excel row visibility. Only overlay fields import; Fishbowl facts stay live.

The controlled 2026-07-13 production seed reconciled 49 workbook orders: 47
new overlays, 2 already identical, 0 updates, 0 unknowns, and 0 validation
errors. Five rows still require dates and one order remains an Estimate until
Fishbowl advances its status.

The same-day P7 detail refresh succeeded for all 49 orders. Fishbowl nests kit
components under the master line's `kitItems`; those 1,169 component rows are
now expanded into the canonical line cache. All 47 populated workbook KITS
counts match Fishbowl. Forty of 47 populated workbook Line Items counts match
the authoritative expanded SO lines; seven differ by one or two lines and
remain workbook-reconciliation exceptions rather than reasons to change the
Fishbowl-derived rule. Pick progress uses `quantityPicked` (falling back to
fulfilled only when Fishbowl does not provide a picked value).

When sparse Fishbowl headers advance but line items are stale, P7 supports the
bounded `detail.refresh` action with an explicit list of up to 250 `-KIT`
orders. It re-reads authoritative order detail and replaces the cached line set
without clearing the list-endpoint-only issued date.

## Phase 2 (shipped)

- **Due-based urgency everywhere**: kit orders with entered need-by dates
  drive severity from the real ship deadline (late / ≤3 workdays warn) on
  the wallboard lanes (chip shows `SHIP M/D` or `LATE` instead of age, and
  the staging table appears on the card) and in the Kit Galaxy (planet
  color/pulse; tooltip + detail panel show ship-by, need-by, table, rep,
  kit-list state). Kits without dates fall back to age tiers.
- **Performance tab** (`/dashboard/kits`): shipped count, on-time %
  (measurable only where dates were entered — coverage grows with adoption),
  median turn time (workdays PO→ship), rolled up by rep and by school over
  a 90-day window (`getKitKpis`).
- **Backorders tab**: every short part aggregated across open kit orders —
  total short, kits affected, PO coverage + ETA, NO-PO flagged. This is the
  purchasing exception view that replaces the Backorder Report workbook.
