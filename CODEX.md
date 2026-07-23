# Codex Takeover Context — MedShip Prometheus

Last verified: 2026-07-12 (America/Chicago)

This is the durable starting point for future Codex work in this repository.
It records the active architecture, source-of-truth order, repository map,
validation baseline, and the current Shipping Ops / Kit Assembly handoff.

## Read order and source of truth

1. `AGENTS.md` — mandatory contract-pricing governance and repository rules.
2. Current TypeScript/SQL source and applied production schema — authoritative
   for actual behavior.
3. Feature docs under `docs/` — intended behavior and operating procedures.
4. `CLAUDE.md` — useful architecture summary, but some older sections lag the
   current implementation.
5. `PROJECT_SUMMARY.md` and root `README.md` — historical/outdated; do not use
   them as implementation truth without checking source.

For UI styling, `UI_DESIGN_CONTEXT.md` and the current implementation
(`src/app/layout.tsx`, `src/app/globals.css`) are authoritative: Outfit and the
blue/green MedShip palette. `DESIGN_SYSTEM.md` still describes an obsolete
Poppins/purple theme and should not drive new work until reconciled.

## What Prometheus is now

Prometheus (also called Zeus) is no longer only lightweight integration
middleware. It is a Next.js 16 / React 19 operations application backed by
Supabase and Inngest, with live operational caches and multiple governed
workflows.

Major domains:

| Domain | Primary paths |
| --- | --- |
| Auth, roles, users, 2FA | `src/lib/auth.ts`, `src/lib/users.ts`, `src/app/api/auth/`, migrations 025–029 and 043–044 |
| Salesforce and Fishbowl sync | `src/lib/salesforce/`, `src/lib/fishbowl/`, `src/inngest/functions/` |
| Dashboard/reporting | `src/app/dashboard/`, `src/components/dashboard/`, `src/lib/data.ts` |
| Shipping Ops wallboard | `src/app/warehouse-board/`, `src/components/warehouse-board/`, `src/lib/warehouse-board/`, migrations 040–042 |
| Kit Galaxy | `src/components/warehouse-board/KitGalaxy.tsx`, `src/lib/warehouse-board/galaxy-data.ts` |
| Nursing Kit Production Manager | `src/app/dashboard/kits/`, `src/components/kits/`, `src/lib/kits/`, `src/app/api/kits/`, migration 045 |
| Supplier catalog / Hercules | `src/app/dashboard/catalog/`, `src/lib/hercules/`, migrations 024 and 035–038 |
| Contract pricing | `pricing_ingestion/`, `src/lib/pricing/`, `src/app/dashboard/pricing/`, migrations 005, 008, 020 |
| Packaging estimator | `src/components/estimator/`, `src/lib/estimator/`, `src/lib/packing-engine/`, migrations 023, 031–033 |
| Incentives and cohorts | `src/lib/incentive/`, `src/components/incentive/`, migrations 021 and 024–034 |
| Kanban | `src/app/dashboard/kanban/`, `src/components/kanban/`, `src/lib/kanban/`, migration 039 |
| Nursing TAM | `src/app/dashboard/tam/`, `src/lib/tam/`, migrations 019a–019d |

## Shipping Ops and kit data flow

```text
Fishbowl
  ├─ P7 sales-order cache ──> fb_sales_orders + fb_sales_order_items
  ├─ P2 inventory sync ─────> inventory_snapshot
  ├─ P11 purchase orders ───> fb_purchase_orders + fb_purchase_order_items
  │                           + replace-all fb_open_po_lines
  └─ P12 shipments ─────────> replace-all fb_recent_shipments

Supabase caches
  ├─ getWallboardData() ────> /warehouse-board Board view
  ├─ getKitGalaxyData() ────> /warehouse-board Kit Galaxy view
  └─ getKitWorkbench() ─────> /dashboard/kits
                                + kit_orders human-owned overlay
```

The spreadsheet is no longer supposed to be a second database for kit facts.
Fishbowl owns orders, lines, inventory, picking, and shipments. `kit_orders`
owns only human planning inputs: need-by dates, transit days, rep, staging
table, checkoffs, and notes.

## Access model

- `/warehouse-board` accepts either the 90-day shared display cookie or a
  signed-in `superadmin`, `admin`, `staff`, or `warehouse` user.
- `/dashboard/kits` and `PATCH /api/kits/[soNumber]` allow those same four
  roles.
- Kit CSV import is intentionally limited to `superadmin`, `admin`, and
  `staff`; warehouse users can edit rows but cannot run the bulk seed.
- Application reads/writes use the server-only service-role client. RLS is
  still required as defense in depth for direct Data API access.
- Current defect: production `is_staff_up()` includes only superadmin/admin/
  staff, so warehouse JWTs do not satisfy the policies on `kit_orders`,
  `fb_open_po_lines`, or `fb_recent_shipments`. See the audit.

## Production snapshot (verified through 2026-07-13)

Supabase project: `MedShip Prometheus` (`qknotdnyewlvtucuzklk`).

- Migrations through `046_atomic_kit_import` are applied; the atomic import RPC
  is executable only by `service_role`.
- Core scale: about 65k sales orders and 505k sales-order line rows.
- P11 cache: about 20.7k PO headers, 82k PO lines, 625 current open PO lines.
- P12 cache: 31 recent shipment rows; last refreshed 2026-07-12 17:37 UTC.
- P2 inventory completed its 08:01 Chicago run successfully with 4,675 source
  records processed; the inventory cache is current for Monday operations.
- The Nursing Kit workbook seed is complete: 49 workbook orders have overlays
  (47 controlled inserts plus 2 already-identical rows), with 47 immutable
  import audit records. Five still need dates and one remains a Fishbowl
  Estimate.
- All 49 workbook SOs matched the Fishbowl cache. One older open `-KIT` order
  not present in the workbook remains intentionally unseeded and visible as a
  needs-dates exception.
- Sparse P7 header refreshes had advanced several current orders while their
  detail/line-item rows remained stale. Authoritative detail hydration then
  succeeded for all 49 workbook orders. Fishbowl's 1,169 nested `kitItems`
  component rows were expanded into the canonical cache: all 47 populated kit
  counts match, while 40 of 47 populated workbook line counts match and seven
  remain small source-reconciliation differences.
- No Closed Short kit was present in the trailing 90-day production sample,
  but source logic still classifies Closed Short as shipped.

Do not copy customer names, item details, prices, or raw production rows into
documentation or fixtures. Aggregate operational counts are sufficient for
diagnostics.

## Commands and validation baseline

Run from repository root:

```powershell
npm run build
npx eslint src/app/warehouse-board src/components/warehouse-board `
  src/lib/warehouse-board src/app/dashboard/kits src/components/kits `
  src/lib/kits src/app/api/kits src/app/api/sync/shipments `
  src/app/api/sync/purchase-orders
```

Current results through 2026-07-13:

- `npm run build`: passes, including the guarded kit importer and targeted P7
  detail-refresh path. It emits two unrelated pricing artifact-reader tracing
  warnings.
- Targeted feature ESLint: fails at `WallboardClient.tsx:460` for a synchronous
  state update inside an effect.
- Full `npm run lint`: exceeded two minutes because repository-local ignored
  Claude worktrees contain very large nested copies.
- Standalone `npx tsc --noEmit`: fails because tests import `vitest`, which is
  not declared/installed, plus two stale Salesforce test signatures.
- `npx vitest run`: unavailable because Vitest is not installed and there is
  no test script in `package.json`.
- `node --test src/lib/kits/__tests__/import.test.ts` passes 9 tests covering
  exact Notes mapping, non-destructive blanks, CSV/Excel paste parsing,
  validation, status filtering, duplicates, deterministic previews, calendar
  validation, and the confirmed weekend-skipping ship deadline.
- `node --test src/lib/fishbowl/__tests__/sales-order-cache.test.ts` passes the
  nested-kit component expansion and parent-lineage test.
- Shipping Ops, Kit Galaxy, kit PATCH APIs, P11, and P12 still lack dedicated
  deterministic coverage.

## Repository hygiene

- Never inspect or modify `.env.local` contents in handoff documents.
- Never commit real distributor spreadsheets or generated pricing outputs.
- Preserve unrelated worktree changes. At takeover, these user-owned files
  were untracked: `Packaging-Estimator-Dims-Briefing.docx`,
  `docs/Zeus-Supplier-Catalog-Smart-Search.docx`, and
  `docs/contract-pricing-ingestion-handoff-2026-07-09.md`.
- `.claude/worktrees/` is excluded locally through `.git/info/exclude` and
  contains large nested repositories. Do not include it in audits, linting,
  file counts, or searches.
- `.env.example` does not currently list `WAREHOUSE_BOARD_PASSWORD`; the
  feature docs do.

## Immediate work queue

The prioritized evidence and acceptance gates are in
`docs/shipping-ops-kits-audit-2026-07-12.md`. The shortest safe sequence is:

1. Correct warehouse RLS and verify with a warehouse JWT.
2. Keep inventory freshness under observation; the 2026-07-13 Monday P2 run
   succeeded after the prior stale snapshot.
3. Decide and implement real allocation semantics for on-hand and PO coverage.
4. Add a true PO-received source or relabel the metric; stop calling SO issue
   date “PO received.”
5. Stop treating Closed Short as shipped and make actual shipment date the
   consistent source for 30/90-day history.
6. Deploy the non-destructive preview/apply importer and targeted P7 detail
   refresh, then add durable audit history for individual kit PATCH edits.
7. Add broader deterministic coverage for Shipping Ops, Kit Galaxy, P11/P12,
   Chicago date rollover, and kit PATCH authorization/auditing.

## Required operating documents

- `docs/warehouse-wallboard.md` — technical wallboard behavior and caches.
- `docs/Warehouse-Wallboard-Operations-Guide.docx` — floor guide; content was
  structurally reviewed, but visual render QA could not run because
  LibreOffice is unavailable in this environment.
- `docs/kit-assembly.md` — kit module implementation summary.
- `docs/Kit-Assembly-SOP.docx` — go-live SOP; structurally reviewed and found
  to overstate several current capabilities documented in the audit.
- `docs/kanban-module.md` — task-board access and identity model.

When code behavior changes, update the relevant Markdown and Word operating
guide in the same change. Operational claims must be backed by deterministic
code and tests.
