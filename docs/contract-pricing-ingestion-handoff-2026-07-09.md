# Contract Pricing Ingestion Handoff

Date: 2026-07-09

## Executive Summary

Prometheus/Zeus now has a governed contract-pricing ingestion path for inconsistent distributor pricing workbooks. The flow can discover workbook structure, apply distributor-specific ingestion profiles, run deterministic dry-runs, stage reviewed rows into Supabase, approve a staged batch, and prepare pending inactive supplier cost lines.

The current pilot batch has reached the prepared-publish state. It has not been activated. No customer sell-pricing tables have been touched.

## Current Live State

Supabase project: `MedShip Prometheus`

Pilot batch:

- Batch ID: `296b727d-08d1-4269-8256-0f897fe7ac5f`
- Dry-run ID: `staging_smoke_20260626T000257Z_detecto_v2_updated`
- Batch status: `publishing`
- Staged rows: 36
- Exceptions: 0
- Linked supplier contract: 1
- Pending inactive supplier cost lines: 36
- Active supplier cost lines: 0
- Publish events: 2

The pending cost lines are buy-side supplier contract costs only. They are not active and are not customer-facing sell prices.

## Completed Phases

### Phase 1: Discovery And Deterministic Ingestion

Implemented a Python ingestion toolkit under `pricing_ingestion/`:

- Workbook discovery and analysis
- Distributor profile validation
- Deterministic dry-run extraction
- Normalization helpers
- Exception review reports
- Business decision application
- Sanitized unittest coverage

Root Python dependency support was added through `requirements.txt` with `openpyxl`.

### Phase 2: Reviewed V2 Profiles

Created reviewed v2 profiles:

- `pricing_ingestion/profiles/detecto_v2.json`
- `pricing_ingestion/profiles/quantum_storage_v2.json`
- `pricing_ingestion/profiles/health_care_logistics_v2.json`

Important profile decisions:

- Buy-side price semantics are treated as cost.
- Required metadata includes contract number and effective date before staging readiness.
- Source lineage is preserved for every proposed row.
- No package conversions are inferred.

### Phase 3: Migration/Staging Layer

Added migration:

- `supabase/migrations/020_contract_pricing_migration_layer.sql`

Created tables:

- `pricing_ingestion_batches`
- `pricing_ingestion_rows`
- `pricing_ingestion_exceptions`
- `supplier_contracts`
- `supplier_contract_cost_lines`
- `pricing_publish_events`

Migration `020_contract_pricing_migration_layer` has been applied to the connected Supabase project.

### Phase 4: Pilot Staging

The selected pilot workbook was rerun through `detecto_v2`.

Aggregate dry-run result:

- Rows scanned: 38
- Proposed rows: 36
- Valid rows: 36
- Warning rows: 0
- Blocking rows: 0
- Excluded rows: 1

Migration preflight passed:

- Rows eligible to stage: 36
- Metadata gaps: 0
- Lineage gaps: 0
- Missing price UOM: 0

Staging result:

- Rows staged: 36
- Exceptions staged: 0
- No supplier cost lines created during staging

### Phase 5: Review And Approval Gate

Added API/UI support for review:

- `GET /api/pricing/contract-migration/batches`
- `GET /api/pricing/contract-migration/batches/[id]`
- `GET /api/pricing/contract-migration/batches/[id]/rows`
- `GET /api/pricing/contract-migration/batches/[id]/exceptions`
- `PATCH /api/pricing/contract-migration/batches/[id]/exceptions/[exceptionId]`
- `POST /api/pricing/contract-migration/batches/[id]/approve`
- `GET /api/pricing/contract-migration/batches/[id]/publish-preview`

The pilot batch was approved. Approval created an audit event but did not publish or activate costs.

### Phase 6: Prepare Pending Cost Lines

Added API/UI support for prepare-publish:

- `POST /api/pricing/contract-migration/batches/[id]/prepare-publish`

Prepare-publish behavior:

- Requires an approved or already-prepared batch.
- Creates or reuses a supplier contract.
- Replaces only this batch's pending inactive cost lines for idempotent retry.
- Creates `supplier_contract_cost_lines` with `active = false`.
- Sets `approval_status = pending`.
- Preserves source file, workbook hash, sheet, row number, source column map, and source cell map.
- Does not activate costs.
- Does not touch customer sell-pricing tables.

Pilot prepare-publish result:

- Supplier contracts created/linked: 1
- Pending inactive cost lines created: 36
- Active cost lines created: 0
- Non-pending cost lines created: 0

## Key Code Areas

Ingestion tooling:

- `pricing_ingestion/discovery/`
- `pricing_ingestion/dry_run/`
- `pricing_ingestion/profiles/`
- `pricing_ingestion/review/`
- `pricing_ingestion/tests/`

Migration/service layer:

- `supabase/migrations/020_contract_pricing_migration_layer.sql`
- `src/lib/pricing/contract-migration/types.ts`
- `src/lib/pricing/contract-migration/artifact-reader.ts`
- `src/lib/pricing/contract-migration/planner.ts`
- `src/lib/pricing/contract-migration/preflight.ts`
- `src/lib/pricing/contract-migration/stage.ts`
- `src/lib/pricing/contract-migration/repository.ts`
- `src/lib/pricing/contract-migration/index.ts`

CLI:

- `scripts/pricing-contract-migration.mjs`

API routes:

- `src/app/api/pricing/contract-migration/preflight/route.ts`
- `src/app/api/pricing/contract-migration/batches/route.ts`
- `src/app/api/pricing/contract-migration/batches/[id]/route.ts`
- `src/app/api/pricing/contract-migration/batches/[id]/rows/route.ts`
- `src/app/api/pricing/contract-migration/batches/[id]/exceptions/route.ts`
- `src/app/api/pricing/contract-migration/batches/[id]/exceptions/[exceptionId]/route.ts`
- `src/app/api/pricing/contract-migration/batches/[id]/approve/route.ts`
- `src/app/api/pricing/contract-migration/batches/[id]/publish-preview/route.ts`
- `src/app/api/pricing/contract-migration/batches/[id]/prepare-publish/route.ts`

Dashboard routes:

- `src/app/dashboard/pricing/imports/page.tsx`
- `src/app/dashboard/pricing/imports/[id]/page.tsx`
- `src/app/dashboard/pricing/exceptions/page.tsx`

## Standard Commands

Run Python ingestion tests:

```powershell
C:\Users\16303\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe -m unittest pricing_ingestion.tests.test_discovery pricing_ingestion.tests.test_analysis pricing_ingestion.tests.test_profiles pricing_ingestion.tests.test_normalization pricing_ingestion.tests.test_dry_run pricing_ingestion.tests.test_exception_review pricing_ingestion.tests.test_decisions
```

Run migration CLI tests:

```powershell
node --test src\lib\pricing\contract-migration\__tests__\pricing-contract-migration-cli.test.mjs
```

Run targeted lint:

```powershell
npx.cmd eslint src/lib/pricing/contract-migration src/app/api/pricing/contract-migration src/app/dashboard/pricing/imports src/app/dashboard/pricing/exceptions
```

Run production build:

```powershell
npm.cmd run build
```

Build note: the first build can fail in a sandbox if Google Fonts cannot be fetched. A network-enabled rerun has passed. The build still reports nonfatal Turbopack tracing warnings around `artifact-reader.ts`.

## Verification History

Recent checks passed:

- Python ingestion tests: 34 passed
- Migration CLI tests: 3 passed
- Targeted ESLint: passed
- Production build: passed after network-enabled Google Fonts fetch

The CLI tests intentionally print expected negative-path JSON errors for missing Supabase credentials and disabled publish. Those are test assertions, not failures.

## Data Protection Rules

Continue to follow these rules:

- Do not commit real distributor spreadsheets.
- Do not commit generated discovery or dry-run outputs containing real commercial values.
- Do not print prices, SKUs, item descriptions, manufacturer part numbers, account numbers, contract numbers, locations, or full source rows.
- Filenames, profile names, header names, aggregate counts, statuses, and exception code names are acceptable.
- Keep all price extraction deterministic.
- Preserve source lineage for every imported row.
- Do not call the OpenAI API for actual price extraction.
- Do not infer package conversions.

Ignored paths confirmed:

- `data/pricing/raw/**`
- `data/pricing/manifest.csv`
- `data/pricing/business_decisions.local.json`
- `data/pricing/uom_decisions.local.csv`
- `outputs/pricing_discovery/**`

## Current Limitations

- Final activation/publish is not implemented.
- Rollback is not implemented.
- Active supplier cost resolver is not implemented.
- Item matching is not implemented.
- Role model is still coarse. Migration 020 uses broad authenticated read policies that were explicitly approved for this stage.
- Local dev-server API/dashboard probing was unreliable in the Windows shell, but build-time route compilation passed and Supabase aggregate reads verified the live data state.
- Turbopack reports nonfatal broad filesystem tracing warnings for the local dry-run artifact reader.

## Next Phase

Next phase: Final Publish Activation and Rollback Controls.

Recommended scope:

1. Add a final publish endpoint for batches in `publishing` status only.
2. Activate pending cost lines:
   - `active = true`
   - `approval_status = approved`
   - set approval metadata
3. Supersede prior active supplier cost lines for the same supplier contract and item/UOM identity.
4. Write publish audit events.
5. Add rollback controls:
   - deactivate lines from a published batch
   - mark batch `rolled_back`
   - preserve rollback linkage
6. Add an active supplier cost resolver read path for Zeus.
7. Add UI confirmation states for final publish and rollback.
8. Verify again that customer sell-pricing tables are untouched.

Do not proceed to final activation without a clear explicit approval gate.

## Fast Resume Checklist

1. Read `.agents/skills/contract-pricing-ingestion/SKILL.md`.
2. Confirm Supabase target is `MedShip Prometheus`.
3. Check the pilot batch aggregate state.
4. Run targeted lint and tests after any change.
5. Keep all reporting aggregate-safe.
6. Do not stage or commit unless explicitly requested.
