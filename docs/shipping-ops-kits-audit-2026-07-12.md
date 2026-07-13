# Shipping Ops, Kit Galaxy, and Nursing Kit Production Audit

Audit date: 2026-07-12
Repository commit: `cf38225` (`master`, aligned with `origin/master`)
Scope: authored repository source, migrations, feature docs, two Word operating
guides, recent feature history, production schema/aggregate state, build,
TypeScript, lint, and test configuration.

## Operational update — 2026-07-13

- P2 inventory completed successfully at 08:01 Chicago and the Monday
  inventory checkpoint is green.
- The active Nursing Kit workbook was inspected as native XLSX. Its visible
  active section contains 49 orders; 123 hidden historical order rows would
  also be exported by a whole-sheet CSV save, so row visibility is not a safe
  import boundary.
- The business owner confirmed Latest Ship Date is Absolute Need By minus Days
  In Transit in weekdays, skipping Saturday/Sunday, with no extra buffer.
  Zeus's `shipDeadline()` is correct. The workbook's current formula subtracts
  two additional workdays and should be corrected in the workbook.
- A deterministic preview of production returned 49 eligible, 47 inserts, 2
  unchanged, 0 updates, 0 unknown, 0 duplicate, and 0 invalid rows. The 47
  inserts were applied in a guarded transaction and generated 47 `audit_log`
  rows. Independent verification found 49 workbook overlays, no overlays
  outside the workbook set, five needs-dates rows, one Estimate, and the
  previously populated general note unchanged.
- A non-destructive preview/digest/apply importer, exact Notes mapping, focused
  tests, and a bounded P7 targeted detail-refresh path are implemented in the
  working tree. Deployment is still required before the UI receives them.
- P7 then hydrated all 49 workbook orders without a detail failure. The refresh
  proved Fishbowl's Kit line contains the component set in nested `kitItems`;
  the prior cache kept only the master. The 1,169 nested rows were expanded
  into production. All 47 populated workbook kit counts now match Fishbowl;
  40 of 47 populated line counts match, with seven one/two-line source
  discrepancies left for workbook review. Working-tree readers now use
  `quantityPicked` for pick progress and remaining-to-pick calculations.

## Executive assessment

The three products are real, integrated, deployed in the production schema,
and the production build passes. The core architecture is sensible: Fishbowl
facts are cached, the wallboard is read-only, kit-specific human inputs live in
a narrow overlay, and P11/P12 are registered with Inngest.

They should not yet be described as operationally trustworthy without
qualification. The largest risks are data semantics rather than rendering:
warehouse RLS is incomplete, inventory is stale, stock/PO coverage can be
overstated, performance metrics are mislabeled, Closed Short is counted as
shipped, edit history does not exist, and no feature-specific automated tests
protect the rules.

## What was reviewed

- Approximately 475 authored TypeScript/SQL/Markdown files (about 80k lines)
  were inventoried; dependency, build, raw-data, output, and nested Claude
  worktree copies were excluded.
- All feature source under:
  - `src/app/warehouse-board/`
  - `src/components/warehouse-board/`
  - `src/lib/warehouse-board/`
  - `src/app/dashboard/kits/`
  - `src/components/kits/`
  - `src/lib/kits/`
  - `src/app/api/kits/`
  - P11/P12 routes and Inngest functions
  - auth/sidebar dependencies and migrations 040–045
- Technical Markdown plus `Warehouse-Wallboard-Operations-Guide.docx` and
  `Kit-Assembly-SOP.docx`.
- Production Supabase metadata and aggregate counts only; no customer, item,
  price, or raw order data was copied.

The DOCX renderer could not run because LibreOffice is unavailable. Both files
were structurally extracted and checked for comments/tracked changes (none),
but page layout remains visually unverified.

## Go-live blockers

### A1 — Warehouse database access is not wired into the staff tier

Severity: High
Evidence: `supabase/migrations/026_rls_role_tiers.sql:28`,
`supabase/migrations/043_warehouse_role_enum.sql:7`,
`supabase/migrations/044_warehouse_role_wiring.sql:4`,
`supabase/migrations/045_kit_orders.sql:26`

The app accepts the `warehouse` role, but migration 044 only updates the signup
trigger. It does not update `is_staff_up()`. Production confirms the function
still returns true only for `superadmin`, `admin`, and `staff`.

Impact:

- App pages currently work because server code uses the service role.
- Direct authenticated Data API reads by a warehouse JWT are denied for
  `kit_orders`, `fb_open_po_lines`, `fb_recent_shipments`, and every other
  Class O policy that calls `is_staff_up()`.
- The migration comment claiming warehouse is included is false.

Required acceptance test: refresh a real warehouse user JWT, then verify the
intended direct SELECT behavior for Class O tables and denial for Class P
supplier-cost tables.

### A2 — Inventory is stale, so stock and backorder conclusions are stale

Severity: High
Evidence: production aggregate verification; `src/lib/warehouse-board/data.ts:299`,
`src/lib/kits/data.ts:315`

Production `inventory_snapshot` last refreshed at 2026-07-09 09:49 UTC. The
wallboard and kit workbench both calculate availability and shortage from that
cache. SO and shipment caches were current on July 12, so the UI can look alive
while its material-availability conclusion is several days old.

Required acceptance test: a healthy P2 run updates `inventory_snapshot`, the
INV pill becomes fresh, and a known sanitized part reconciles to Fishbowl.

### A3 — Stock and PO coverage do not allocate shared quantities

Severity: High
Evidence: `src/lib/warehouse-board/data.ts:340`,
`src/lib/kits/data.ts:379`

The current algorithms compare every line independently to the full global
on-hand quantity. They do not reserve inventory across repeated lines, across
orders, or across kits. The kit algorithm also sets `onOrder` when any open PO
quantity exists, even when that quantity is smaller than the shortage.

Examples of wrong outcomes:

- Two lines each need 8 units and only 10 are on hand; both can be reported
  coverable because each line independently sees all 10.
- Several open kits compete for the same part; every kit can look clear.
- A shortage of 100 with 1 unit on an open PO is labeled `PO` rather than
  partially/uncovered.

This contradicts the operating guides' claims that `STOCK ✓` means the order
can be picked now and that amber PO coverage means the short remainder is
covered.

Business decision required: define allocation order (ship deadline, issued
date, explicit reservation, or informational aggregate only). Then implement
one deterministic allocator shared by the board and kit manager.

### A4 — “PO received → shipped” is actually SO issued → completed

Severity: High
Evidence: `src/lib/kits/data.ts:155`, `src/lib/kits/data.ts:405`,
`src/components/kits/KitsWorkbench.tsx:394`

There is no PO-received field in `kit_orders`, the import ignores the workbook's
PO Received column, and both workbench and KPI code use `date_issued` as the
start of turn time. The UI and SOP call this value “PO received.”

Required decision: either add a governed PO-received source/field with lineage,
or relabel every metric and SOP statement as “SO issued → shipped.” Do not use
the current number for production performance management under its present
label.

### A5 — Closed Short is treated as shipped

Severity: High
Evidence: `src/lib/warehouse-board/galaxy-data.ts:182`,
`src/lib/kits/data.ts:136`, `src/lib/kits/data.ts:374`

Kit Galaxy, the workbench, and the 90-day KPI include `Closed Short` in the
shipped state. This turns incomplete/cancelled fulfillment into green shipped
throughput and can score it on-time. The wallboard itself correctly keeps
Closed Short in a separate review rail, so the products disagree.

Production had zero Closed Short kits in the trailing 90-day sample, so the
defect is latent today, not hypothetical logic debt.

Required acceptance test: a sanitized Closed Short kit is excluded from shipped
KPIs and appears only in an explicit exception/closed-short state.

### A6 — The SOP promises edit history that does not exist

Severity: High
Evidence: `supabase/migrations/045_kit_orders.sql:9`,
`src/app/api/kits/[soNumber]/route.ts:84`, `src/lib/audit.ts:23`

`kit_orders` stores only the latest `updated_at` and `updated_by`. Kit routes do
not call `logAudit`, and there is no history table or trigger. The SOP statement
“Every edit records who made it and when” implies a durable event history that
the implementation cannot provide.

Required acceptance test: each field change and CSV import creates an immutable
audit record containing actor, SO, changed fields, old/new values, and time.

### A7 — Monday seed is incomplete

Severity: High for go-live
Evidence: production aggregate verification

There are 49 open kit orders and only 2 overlay rows. Both overlay rows have
dates, but the bulk workbook seed described in the SOP has not populated the
open book.

Required acceptance test: import in dry-run/preview mode, reconcile recognized
columns and skipped SOs, apply once approved, then spot-check at least five
ship windows against the workbook.

Status 2026-07-13: production seed completed and independently reconciled as
described in the operational update. Five workbook rows intentionally remain
needs-dates because their source cells are blank. One workbook order is still
an Estimate and will not enter the open workbench until Fishbowl advances it.

## Important correctness and resilience findings

### B1 — CSV import can erase fields and hides row failures

Severity: Medium-High
Evidence: `src/app/api/kits/import/route.ts:89`,
`src/app/api/kits/import/route.ts:131`

- Missing/unrecognized optional columns are still written as null, so rerunning
  a partial CSV can erase existing need-by, rep, table, or notes values.
- Per-row upsert errors are ignored; the response reports only successful count
  and unknown SOs.
- Invalid dates are normalized weakly and database errors are not returned per
  row.
- Duplicate SO rows are not surfaced.
- There is no dry-run preview or explicit approval step even though this import
  replaces the canonical workbook overlay.

Make import patch-only, validate every row, return deterministic errors, add a
preview artifact, and write only after explicit confirmation.

Status 2026-07-13: implemented in the working tree. Blank/missing values
preserve existing data; headers use exact aliases; duplicate, date, transit,
length, unknown-order, and status checks are deterministic; preview returns a
SHA-256 digest and apply recomputes it against live state; applied imports write
old/new audit detail. The production seed used the same logic in an atomic,
guarded transaction. UI/API deployment remains outstanding.

### B2 — Actual shipment date is not consistently authoritative

Severity: Medium-High
Evidence: `src/lib/warehouse-board/galaxy-data.ts:180`,
`src/lib/kits/data.ts:372`, `src/lib/kits/data.ts:127`,
`src/lib/warehouse-board/shipments-sync.ts:8`

Galaxy/workbench prefer `date_completed` before a shipment timestamp, unlike
the wallboard which chooses the later date. P12 keeps only ten days of shipment
records, while the workbench shows 30 days and performance covers 90 days.
`getKitKpis()` ignores shipment records entirely.

Result: current-floor shipping can be accurate while historical performance
falls back to SO completion dates and is not the “actual ship date” promised by
the SOP.

Persist durable shipment facts or a canonical actual-ship date for the full
reporting window, then use the same resolver in all three products.

### B3 — Workday math is untested and uses UTC-derived “today”

Severity: Medium
Evidence: `src/lib/kits/workdays.ts`, `src/lib/kits/data.ts:221`,
`src/lib/warehouse-board/data.ts:402`

The implementation skips weekends but has no holiday calendar. Server “today”
comes from UTC, so urgency can roll to the next day during Chicago evening
hours. There are no tests for weekends, zero/negative days, DST boundaries,
Chicago date rollover, or the workbook's buffered Latest Ship Date behavior.

Business decision required: confirm whether “workday” means weekdays only or a
company holiday calendar, and confirm which need-by date drives on-time.

Status 2026-07-13: confirmed as weekdays excluding Saturday/Sunday, driven by
Absolute Need By for Latest Ship Date, with no extra two-day buffer. A focused
test now locks the 2026-08-10 minus two transit days = 2026-08-06 example. A
company-holiday calendar and Chicago “today” rollover remain unresolved.

### B4 — P11 durable PO lines never remove source-deleted lines

Severity: Medium
Evidence: `src/lib/warehouse-board/po-sync.ts:223`

Changed headers and current lines are upserted, but a line deleted from a PO in
Fishbowl remains forever in `fb_purchase_order_items`. The wallboard fast cache
is replace-all and avoids this, but the durable P11 foundation can drift before
future purchasing features consume it. Non-array line responses are also
treated as success instead of failing the PO page.

### B5 — P11/P12 lack the repository's normal sync audit trail

Severity: Medium
Evidence: `src/inngest/functions/purchase-orders-sync.ts`,
`src/inngest/functions/shipments-sync.ts`, compared with
`src/inngest/functions/fishbowl-sales-orders-sync.ts:279`

P11/P12 do not write `sync_events` or update `sync_schedules`. Failures appear in
Inngest but not in the application-wide audit/monitoring model described by
`CLAUDE.md`. Replace-all writes are not transactional; an insert/delete split
failure can leave multiple generations until a later successful run.

### B6 — Query errors are inconsistently checked

Severity: Medium
Evidence: `src/lib/warehouse-board/data.ts:189`,
`src/lib/warehouse-board/galaxy-data.ts:114`

The wallboard checks the open-order query but not both Fulfilled and Closed
Short query errors. Galaxy ignores errors on ops and shipment lookups. A partial
database failure can silently render incomplete but plausible output.

### B7 — Production Manager optimistic edits fail silently

Severity: Medium
Evidence: `src/components/kits/KitsWorkbench.tsx:53`,
`src/components/kits/KitsWorkbench.tsx:64`

State is updated from `useMemo()` during render, and PATCH failures are neither
reported nor rolled back. The targeted linter catches a related synchronous
effect update in `WallboardClient.tsx:460`; the render-time setter is also the
wrong lifecycle primitive. Users can believe an edit saved when it did not.

Also, shipped rows with known deadlines display the planned ship window before
the shipped/on-time result (`KitsWorkbench.tsx:617`), hiding the most useful
historical outcome.

### B8 — Kit Galaxy leaks render resources across 60-second rebuilds

Severity: Medium for always-on displays
Evidence: `src/components/warehouse-board/KitGalaxy.tsx:45`,
`src/components/warehouse-board/KitGalaxy.tsx:311`

Label sprite materials are disposed, but their canvas textures are not. Shared
textures/geometries and the starfield are not fully disposed on unmount. The
wallboard rebuilds Galaxy data every refresh, so an always-on TV can accumulate
GPU resources. Selection/hover objects can also remain stale after a rebuild.

Add disposal tests/instrumentation and a soak test covering several hours of
refreshes.

## Testing and delivery gaps

### C1 — No automated coverage for any of the three products

No matching test covers:

- lane classification, drop-ship exclusion, partial shipment union, KPI counts
- stock allocation and PO quantity coverage
- kit suffix recognition, kit master quantity heuristic, Closed Short behavior
- workday/ship-deadline rules and Chicago date handling
- CSV parsing, validation, destructive-field protection, permissions
- PATCH validation/audit behavior
- P11/P12 replace-all and retry/idempotency behavior
- Kit Galaxy rebuild/disposal or workbench save failures

Vitest configuration and test files exist elsewhere, but `vitest` is not in
`package.json` and is not installed. Standalone TypeScript also finds two stale
Salesforce test call signatures.

### C2 — Environment and docs drift

- `.env.example` omits `WAREHOUSE_BOARD_PASSWORD`.
- `PROJECT_SUMMARY.md` and root `README.md` do not describe P11–P13.
- `DESIGN_SYSTEM.md` conflicts with the actual Outfit/blue implementation.
- The Word SOP overstates actual shipment history, PO-received turn time, edit
  history, and PO quantity coverage.
- The Markdown docs say one urgency drives all views, but the Kit Manager uses
  a five-workday “this week” window while wallboard/Galaxy warn at three.

### C3 — Public wallboard gate has no throttling

Evidence: `src/app/api/warehouse-board/gate/route.ts:7`

The cookie design is reasonable and password rotation invalidates sessions,
but the public password endpoint has no rate limit or lockout and uses a normal
string comparison. Add edge/application throttling and a constant-time secret
comparison before treating it as a hardened public gate.

## What is working well

- Production build passes and all requested routes are emitted.
- Migrations 040–045 are applied; RLS is enabled on every new table.
- P11/P12 are exported and registered in `/api/inngest`.
- Public board data is rendered server-side; the only unauthenticated API is
  the password gate, not an order-data JSON endpoint.
- Service-role use stays server-only.
- Drop-ship-only orders are excluded while mixed orders keep only Sale/Kit
  warehouse lines.
- P12 shipment facts correctly allow a partial shipment to appear in both
  Picking and Shipped on the wallboard.
- PostgREST pagination is explicitly handled for large line-item reads.
- Human kit inputs are separated from computable Fishbowl facts.
- Need-by/transit input validation has database and route-level bounds.
- New role assignment trusts app metadata, not user-editable metadata.
- Supabase's current guidance supports app-metadata-driven RLS and RLS on
  exposed tables; the architecture follows that pattern even though the
  warehouse tier definition needs correction.

## Validation results

| Check | Result |
| --- | --- |
| `npm run build` | Pass; two unrelated pricing artifact-reader tracing warnings |
| Targeted feature ESLint | Fail: `WallboardClient.tsx:460` synchronous state update in effect |
| Full `npm run lint` | Timed out after two minutes; nested ignored Claude worktrees greatly expand traversal |
| `npx tsc --noEmit` | Fail: missing Vitest types and two Salesforce test signature errors |
| Feature tests | None exist |
| Production migrations | 040–045 applied |
| Production RLS | Enabled on all feature tables; warehouse helper mismatch confirmed |
| Supabase advisors | No new-table missing-RLS finding; project-wide pre-existing security/performance findings remain |
| DOCX visual QA | Blocked: LibreOffice unavailable; structural review completed |

## Recommended implementation sequence

1. Add migration 046 to update the intended role-tier helper(s), revoke
   unintended function execution identified by advisors as a separate security
   hardening change, and verify with real refreshed JWTs.
2. Repair P2 freshness and add an explicit stale-data banner/block for stock
   conclusions when inventory exceeds the accepted threshold.
3. Extract one tested allocation engine for on-hand and open-PO quantity,
   driven by an approved priority rule.
4. Resolve PO-received semantics and actual-ship history before enabling
   performance management.
5. Introduce explicit `closed_short`/exception status across kit data models.
6. Add immutable kit audit events and a safe import preview/apply workflow.
7. Add Vitest as a declared dev dependency and a `test` script; build sanitized
   fixtures for every rule above.
8. Fix client save/error lifecycles and run an always-on Galaxy soak test.
9. Reconcile Markdown, `.env.example`, the two Word guides, and top-level project
   summaries only after the behavior is verified.

## Definition of ready

Do not retire the workbook or use the KPI view for performance management until:

- all 49 open kits are reconciled or intentionally skipped;
- inventory, PO, SO, and shipment freshness is green;
- stock/PO allocation semantics are approved and tested;
- PO-received and actual-ship dates have auditable sources;
- Closed Short does not score as shipped;
- edits/imports have immutable audit history and explicit error reporting;
- warehouse authorization passes at app and database layers;
- deterministic rule tests and at least one end-to-end sanitized fixture pass;
- the operating guides are corrected and visually re-rendered.
