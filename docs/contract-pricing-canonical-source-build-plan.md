# Contract Pricing Canonical Source Build Plan

## Purpose

Move Contract Pricing out of Purchasing Manager-maintained Excel spreadsheets and into Zeus as the canonical system of record for item-level contract pricing.

The transition should preserve spreadsheet flexibility during discovery, then replace it with governed imports, auditable edits, role-based maintenance, pricing calculations, and eventually a controlled spreadsheet deprecation path.

This plan extends the existing Zeus Pricing Intelligence work in:

- `docs/zeus-pricing-implementation-plan.md`
- `docs/salesforce-pricing-fields.md`
- `supabase/migrations/005_zeus_pricing_architecture.sql`
- `/dashboard/pricing`
- `/api/pricing/readiness`

## Target Outcomes

- Zeus stores all active and historical contract pricing for items.
- The Purchasing Manager can import, review, edit, approve, and create contract pricing directly in Zeus.
- Spreadsheet files become intake artifacts, not operational source-of-truth records.
- Every price has lineage: source file, sheet, row, importer, validator, approver, effective dates, and edit history.
- Contract pricing is usable by pricing calculations, margin checks, quote guardrails, Salesforce visibility, and reporting.
- Zeus can detect missing, conflicting, expired, overlapping, or suspicious prices before they affect quoting.

## Current State Assumptions

- Contract Pricing is spread across multiple Excel workbooks maintained manually.
- The workbook formats may not be consistent.
- Some spreadsheets may encode customer-specific, vendor-specific, product-family, UOM, quantity tier, or effective-date logic differently.
- Zeus already has a pricing foundation schema with:
  - `pricing_import_batches`
  - `pricing_products`
  - `product_crosswalk`
  - `customer_contracts`
  - `contract_price_lines`
  - `product_cogs`
  - `pricing_rules`
  - `pricing_quality_results`
  - `pricing_calculation_snapshots`
  - `pricing_guardrail_events`
- Zeus currently has role handling in `src/lib/auth.ts`, but only `admin`, `operator`, and `user` are modeled.

## Guiding Principles

- Import first, enforce later.
- Preserve original spreadsheet evidence even after Zeus becomes canonical.
- Never silently coerce price, date, SKU, UOM, currency, or account values.
- Manual Zeus edits must be more traceable than spreadsheet edits.
- Purchasing Manager workflows should be operationally useful before spreadsheet deprecation begins.
- Pricing enforcement must remain disabled until data coverage and quality gates pass.

## Product Scope

### In Scope

- Spreadsheet inventory and profiling.
- Canonical contract pricing schema refinements.
- Import staging, validation, preview, commit, and rejection workflows.
- Purchasing Manager role and permissions.
- Contract and line-item maintenance UI.
- Audit history and change review.
- Pricing quality checks.
- Readiness metrics.
- Export and reconciliation reports.
- Controlled spreadsheet deprecation process.

### Out of Scope Until Later Phases

- Full Salesforce hard enforcement.
- Automated vendor portal ingestion.
- Automated contract OCR or PDF extraction.
- Advanced rebate, chargeback, or GPO analytics unless present in current spreadsheets.
- Full CPQ implementation.

## Workstreams

## 1. Spreadsheet Discovery And Data Profiling

Objective: understand the real spreadsheet estate before locking the canonical model.

Tasks:

1. Collect the current Contract Pricing spreadsheets.
2. Build a spreadsheet inventory:
   - file name
   - owner
   - workbook purpose
   - active/inactive status
   - update cadence
   - tabs/sheets
   - row counts
   - last modified date
   - downstream consumers
3. Profile each sheet:
   - header names
   - required fields
   - blank percentages
   - duplicate rows
   - hidden sheets
   - formulas
   - merged cells
   - comments/notes
   - currency/date formats
   - UOM conventions
   - tier pricing patterns
4. Classify workbook patterns:
   - customer-specific contracts
   - vendor price lists
   - product master overlays
   - COGS/buy-price sheets
   - discount matrix sheets
   - exception/manual override sheets
5. Produce a field mapping matrix from spreadsheet columns to Zeus fields.

Deliverables:

- `docs/contract-pricing-spreadsheet-inventory.md`
- `docs/contract-pricing-field-mapping.md`
- Sample normalized CSV fixtures for each known spreadsheet pattern.

Acceptance criteria:

- Every active spreadsheet has an owner and classification.
- Every active price-bearing column maps to a canonical Zeus field or is explicitly deferred.
- Spreadsheet formulas that affect price are documented.
- Known dirty-data cases are captured as validation test fixtures.

## 2. Canonical Data Model

Objective: make Zeus capable of storing imported and manually maintained contract pricing with lineage and auditability.

The existing migration `005_zeus_pricing_architecture.sql` is a strong foundation. Additions should focus on spreadsheet staging, validation, audit, and role-backed operations.

### Existing Tables To Use

- `pricing_import_batches`: one record per upload/import.
- `pricing_products`: canonical item identity.
- `product_crosswalk`: Salesforce/Fishbowl/import SKU mappings.
- `customer_contracts`: contract header.
- `contract_price_lines`: item-level contract prices.
- `product_cogs`: cost basis records.
- `pricing_quality_results`: quality gate output.

### Proposed Schema Additions

#### `pricing_import_files`

Tracks each uploaded source file, even if one batch includes multiple files.

Fields:

- `id`
- `batch_id`
- `source_file_name`
- `storage_path`
- `file_hash`
- `mime_type`
- `file_size_bytes`
- `uploaded_by`
- `uploaded_at`
- `parser_version`
- `detected_template`
- `raw_metadata`

#### `pricing_import_sheets`

Tracks workbook sheets/tabs and parsing metadata.

Fields:

- `id`
- `file_id`
- `sheet_name`
- `sheet_index`
- `header_row_number`
- `data_start_row_number`
- `total_rows`
- `parsed_rows`
- `ignored_rows`
- `raw_metadata`

#### `pricing_import_rows`

Staging table for row-level parsed data before commit.

Fields:

- `id`
- `batch_id`
- `file_id`
- `sheet_id`
- `source_row_number`
- `row_hash`
- `raw_data`
- `normalized_data`
- `resolved_contract_id`
- `resolved_pricing_product_id`
- `resolved_account_sf_id`
- `validation_status`
- `validation_errors`
- `validation_warnings`
- `commit_status`
- `committed_contract_line_id`
- `created_at`

#### `contract_price_line_audit`

Immutable change log for every contract line mutation.

Fields:

- `id`
- `contract_price_line_id`
- `action`
- `previous_values`
- `new_values`
- `change_reason`
- `changed_by`
- `changed_at`
- `source_batch_id`
- `source_row_id`

#### `pricing_contract_notes`

Operational notes on contract headers or lines.

Fields:

- `id`
- `contract_id`
- `contract_price_line_id`
- `note_type`
- `body`
- `created_by`
- `created_at`

#### `pricing_user_permissions`

Optional database-backed permission overlay if Supabase app metadata is not enough.

Fields:

- `id`
- `user_id`
- `email`
- `role`
- `is_active`
- `granted_by`
- `granted_at`
- `revoked_at`

Recommended roles:

- `admin`: all pricing and system administration.
- `pricing_manager`: import, create, edit, approve, archive, export, and resolve pricing conflicts.
- `pricing_reviewer`: review imports, comment, request corrections, approve non-destructive changes if allowed.
- `operator`: view pricing, run calculations, request corrections.
- `viewer`: read-only pricing visibility.

### Data Model Rules

- `contract_price_lines` remains the canonical active/historical price table.
- `pricing_import_rows` is the source of truth for pre-commit validation state.
- Uploaded files are evidence and should be retained according to Medical Shipment retention policy.
- Every manual edit creates an audit row.
- Imports are committed atomically at batch or selected-row level.
- Active contract lines cannot overlap for the same contract, product, UOM, quantity tier, currency, and effective date range unless explicitly marked as a conflict under review.

Acceptance criteria:

- Schema supports both spreadsheet-imported and manually created pricing.
- All committed rows can be traced to source file/sheet/row or a manual user action.
- Audit tables answer who changed what, when, and why.

## 3. Import Pipeline

Objective: safely turn diverse spreadsheets into validated Zeus contract price records.

### Import Lifecycle

1. Upload
2. Parse
3. Detect template
4. Normalize
5. Resolve customer/account
6. Resolve product/SKU
7. Validate
8. Preview
9. Commit
10. Reconcile

### Parser Requirements

- Support `.xlsx` initially.
- Reject unsupported formats with clear user guidance.
- Preserve raw cell values and normalized values.
- Detect hidden sheets and warn.
- Detect formula cells and store calculated value plus formula metadata when available.
- Support configurable header row detection.
- Support workbook-specific templates after discovery.

### Normalized Contract Price Fields

Required:

- `contract_number`
- `customer_account_key` or `customer_account_name`
- `product_sku` or `part_number`
- `unit_price`
- `uom`
- `currency`
- `effective_start`

Recommended:

- `effective_end`
- `quantity_min`
- `quantity_max`
- `contract_cost`
- `vendor_name`
- `manufacturer`
- `product_description`
- `source_contract_name`
- `notes`

Optional:

- rebate fields
- freight/landed cost
- GPO/IDN identifiers
- replacement/supersession SKU
- salesperson/territory
- approval metadata from source file

### Validation Rules

Blockers:

- Missing contract number.
- Missing product identifier.
- Product cannot resolve to `pricing_products` or `product_crosswalk`.
- Missing or invalid unit price.
- Negative unit price unless explicitly allowed.
- Invalid effective date.
- Effective end before start.
- Invalid quantity tier.
- Currency mismatch.
- Duplicate active row in same import.
- Overlapping active price line in Zeus.

Warnings:

- Missing effective end date.
- Missing UOM, defaulted to `Each`.
- Product matched by low-confidence heuristic.
- Customer matched by name instead of stable ID.
- Price changed by more than configured threshold from prior active line.
- Contract cost missing.
- Formula-derived price detected.
- Hidden sheet contains price-like data.

### Commit Rules

- Committing a batch writes contract headers, lines, product COGS when applicable, and audit rows.
- A batch can be committed only when blocker rows are resolved or excluded.
- Rows with warnings can be committed if the user has `pricing_manager` or `admin` role.
- Re-importing the same file hash should require explicit confirmation.
- Every superseded active price line should retain history rather than being overwritten.

Acceptance criteria:

- A dirty workbook can be uploaded and reviewed without corrupting canonical pricing.
- The Purchasing Manager can see exactly which rows are blocked and why.
- Valid rows commit to canonical tables with complete lineage.

## 4. Product And Customer Resolution

Objective: make imported contract lines resolve to canonical products and customer contracts reliably.

### Product Resolution Order

1. Existing explicit `product_crosswalk` match.
2. Salesforce `Product2.Id`.
3. Fishbowl part number.
4. Exact normalized SKU.
5. Imported alias approved by a pricing manager.
6. Needs review.

### Customer Resolution Order

1. Salesforce Account Id.
2. External customer/account ID.
3. Exact normalized account name.
4. Approved account alias.
5. Needs review.

### Required UI Workflows

- Product match review queue.
- Customer/account match review queue.
- Bulk approve exact matches.
- Manually link imported SKU/account to canonical record.
- Mark imported row as ignored/non-price row.
- Create new canonical pricing product when product is legitimate but missing.

Acceptance criteria:

- No canonical contract line is created against an unresolved product.
- Ambiguous matches stay in review.
- Approved aliases improve future imports.

## 5. Purchasing Manager Role And Access Control

Objective: give the Purchasing Manager useful autonomy without exposing unrestricted system administration.

### Auth Model Changes

Update `src/lib/auth.ts` role types to include:

- `pricing_manager`
- `pricing_reviewer`
- `viewer`

Recommended role capabilities:

| Capability | admin | pricing_manager | pricing_reviewer | operator | viewer |
| --- | --- | --- | --- | --- | --- |
| View pricing dashboard | yes | yes | yes | yes | yes |
| Upload spreadsheets | yes | yes | yes | no | no |
| Validate imports | yes | yes | yes | no | no |
| Commit imports | yes | yes | no | no | no |
| Create/edit contracts | yes | yes | no | no | no |
| Approve warning rows | yes | yes | no | no | no |
| Resolve product/account matches | yes | yes | yes | no | no |
| Archive/supersede lines | yes | yes | no | no | no |
| Edit pricing rules | yes | no | no | no | no |
| View COGS/cost fields | yes | yes | optional | no | no |
| Export pricing | yes | yes | yes | optional | no |

### API Requirements

- All mutation routes must call `requireApiAuth`.
- Server-side role checks must gate every write; UI hiding is not enough.
- Cost-bearing fields should be omitted from responses unless the role can view them.
- Use the service-role Supabase client only on trusted server routes and background jobs.

Acceptance criteria:

- A Purchasing Manager user can run the full import and maintenance workflow.
- A read-only user cannot mutate pricing through direct API calls.
- Cost visibility is intentionally controlled.

## 6. Zeus UI Build

Objective: make Zeus the Purchasing Manager's daily pricing workspace.

### Routes

Existing:

- `/dashboard/pricing`

Add:

- `/dashboard/pricing/contracts`
- `/dashboard/pricing/contracts/new`
- `/dashboard/pricing/contracts/[id]`
- `/dashboard/pricing/contracts/[id]/lines`
- `/dashboard/pricing/imports`
- `/dashboard/pricing/imports/[id]`
- `/dashboard/pricing/imports/[id]/review`
- `/dashboard/pricing/products`
- `/dashboard/pricing/products/[id]`
- `/dashboard/pricing/matches`
- `/dashboard/pricing/audit`
- `/dashboard/pricing/quality`

### Core Screens

Pricing Home:

- readiness gates
- active contract count
- active contract line count
- blocked import rows
- expiring contracts
- missing product matches
- recent changes

Contract List:

- search by contract number, customer, status, date range
- filters for active, draft, expired, archived
- coverage and line counts
- last updated by/date

Contract Detail:

- header fields
- effective dates
- customer/account mapping
- line table
- import lineage
- audit trail
- notes
- status transitions

Line Editor:

- product picker
- SKU aliases
- unit price
- cost/buy price
- UOM
- quantity tiers
- effective dates
- validation state
- change reason

Import Wizard:

- upload workbook
- detected sheets/templates
- mapping preview
- validation summary
- row-level errors
- product/customer match review
- commit selected rows
- post-commit reconciliation

Product Match Review:

- imported SKU/name
- candidate Zeus/Salesforce/Fishbowl products
- confidence and match method
- bulk approve exact matches
- manual match
- create canonical product

Audit:

- changed object
- previous/new values
- changed by
- source import/manual edit
- timestamp
- reason

Quality:

- overlapping lines
- expired contracts
- soon-to-expire contracts
- missing cost
- missing product match
- price variance outliers
- duplicate rows

Acceptance criteria:

- Purchasing Manager can complete import, correction, commit, and manual edit without database access.
- Every destructive or superseding action requires confirmation and a reason.
- Pricing users can locate and fix common quality issues from the UI.

## 7. API And Service Layer

Objective: centralize pricing operations behind server-side APIs and testable services.

### API Routes

Read:

- `GET /api/pricing/contracts`
- `GET /api/pricing/contracts/[id]`
- `GET /api/pricing/contracts/[id]/lines`
- `GET /api/pricing/imports`
- `GET /api/pricing/imports/[id]`
- `GET /api/pricing/imports/[id]/rows`
- `GET /api/pricing/products`
- `GET /api/pricing/matches`
- `GET /api/pricing/audit`
- `GET /api/pricing/quality`

Mutate:

- `POST /api/pricing/imports`
- `POST /api/pricing/imports/[id]/validate`
- `POST /api/pricing/imports/[id]/commit`
- `POST /api/pricing/imports/[id]/rows/[rowId]/resolve`
- `POST /api/pricing/contracts`
- `PATCH /api/pricing/contracts/[id]`
- `POST /api/pricing/contracts/[id]/lines`
- `PATCH /api/pricing/contracts/[id]/lines/[lineId]`
- `POST /api/pricing/contracts/[id]/lines/[lineId]/archive`
- `POST /api/pricing/products/[id]/aliases`
- `POST /api/pricing/quality/run`

### Service Modules

Add under `src/lib/pricing/`:

- `contracts.ts`
- `contract-lines.ts`
- `imports.ts`
- `spreadsheet-parser.ts`
- `normalization.ts`
- `validation.ts`
- `resolution.ts`
- `audit.ts`
- `permissions.ts`
- `quality.ts`
- `exports.ts`

Service rules:

- Parsing, normalization, validation, and commit should be separate steps.
- Validation should be deterministic and unit-testable.
- Commit should use database transactions or equivalent safe sequencing.
- All write operations should emit audit records.

Acceptance criteria:

- UI routes contain minimal business logic.
- Import validation can run without committing data.
- Mutations are role-gated, audited, and testable.

## 8. Pricing Calculations And Downstream Use

Objective: make canonical contract pricing useful outside the maintenance workflow.

### Required Resolvers

- Resolve active contract for account/date.
- Resolve active line for contract/product/UOM/quantity/date.
- Resolve current cost basis.
- Resolve active pricing rule.
- Calculate suggested retail.
- Calculate minimum quote price.
- Calculate gross margin.
- Emit missing-data reasons.

### Read Models

Consider database views or service-level read models:

- active contract lines by account/product
- current contract price by product
- current COGS by product
- contracts expiring within 30/60/90 days
- price variance from prior version
- missing price coverage by product family

Acceptance criteria:

- Pricing math uses Zeus contract price data, not spreadsheet files.
- Missing or ambiguous data returns explicit results.
- Calculations include source contract, line, rule, and effective date.

## 9. Reporting, Reconciliation, And Exports

Objective: support trust-building while the organization transitions away from spreadsheets.

Reports:

- active contract price book
- contracts expiring soon
- products missing active contract price
- import errors by file/sheet/row
- price changes since last import
- manual edits since last import
- rows excluded from import
- spreadsheet-vs-Zeus reconciliation
- products with multiple active prices
- COGS missing or stale

Exports:

- CSV/XLSX export of active pricing for review.
- Audit export for management review.
- Rejected row export for correction.

Acceptance criteria:

- Purchasing Manager can compare Zeus to the last spreadsheet source.
- Stakeholders can review changes before spreadsheet deprecation.
- Rejected rows can be corrected without rework.

## 10. Spreadsheet Deprecation Plan

Objective: make the transition operationally safe and socially clear.

### Deprecation Stages

Stage 1: Inventory

- Identify every active pricing spreadsheet.
- Label owners and downstream users.
- Freeze structural changes where possible.

Stage 2: Import Pilot

- Import a controlled subset.
- Compare Zeus output to spreadsheet output.
- Fix schema, mapping, and validation gaps.

Stage 3: Parallel Run

- Purchasing Manager continues spreadsheet updates.
- Every spreadsheet change is imported into Zeus.
- Zeus reports differences and quality issues.

Stage 4: Zeus Primary

- New pricing changes are entered in Zeus first.
- Spreadsheets become read-only exports from Zeus.
- Exceptions require management approval.

Stage 5: Spreadsheet Retirement

- Legacy files are archived.
- Zeus becomes the only approved source for active contract pricing.
- Exports are allowed for reporting but not manual maintenance.

### Deprecation Controls

- Add a visible "source of truth" banner to exports.
- Watermark exported spreadsheets as Zeus-generated if feasible.
- Keep legacy workbooks in read-only archive storage.
- Define a cutover date.
- Publish a pricing change SOP.

Acceptance criteria:

- No team relies on an untracked spreadsheet for active pricing after cutover.
- Purchasing Manager has Zeus workflows that are faster or safer than spreadsheet maintenance.
- Legacy spreadsheets remain available for audit/reference only.

## 11. Quality Gates

Do not enable downstream enforcement until these gates pass.

Launch readiness targets should be finalized with Medical Shipment, but recommended initial thresholds are:

- 100% of active contract lines resolve to a canonical product.
- 100% of active contract lines have valid effective start dates.
- 0 blocker validation errors in active imported rows.
- 0 overlapping active contract lines for the same contract/product/UOM/tier/date.
- 95% or higher active product contract-price coverage for pilot scope.
- 95% or higher COGS coverage for pilot scope if margin enforcement is in scope.
- 100% Purchasing Manager workflow coverage for import, edit, archive, and export.
- 100% mutation API role checks.

Quality jobs:

- Nightly pricing quality scan.
- Post-import quality scan.
- Pre-enforcement quality scan.
- Weekly expiring-contract scan.

Acceptance criteria:

- Readiness API reports contract pricing health.
- Pricing dashboard shows blockers and owners.
- Enforcement status is tied to quality results, not optimism.

## 12. Implementation Phases

### Phase 0: Alignment And Access

Duration: 2-3 days.

Tasks:

- Confirm the Purchasing Manager workflow.
- Collect sample spreadsheets.
- Confirm who can see cost/buy price.
- Confirm whether contracts are customer-specific, global, vendor-specific, or mixed.
- Confirm retention policy for uploaded spreadsheets.

Exit criteria:

- Sample files available.
- Role and cost visibility decisions made.
- Pilot scope selected.

### Phase 1: Spreadsheet Profiling

Duration: 3-5 days.

Tasks:

- Analyze workbook structures.
- Create field mapping matrix.
- Identify required schema additions.
- Produce dirty-data fixture set.

Exit criteria:

- Every active spreadsheet pattern is classified.
- Canonical field mapping is approved.

### Phase 2: Schema And Permission Foundation

Duration: 3-5 days.

Tasks:

- Add import file/sheet/row staging tables.
- Add audit table.
- Add role names to auth model.
- Add role helper functions.
- Add mutation route permission pattern.
- Add RLS/policy review.

Exit criteria:

- Migration applies cleanly.
- Role-gated API skeletons are in place.
- Audit writes are possible.

### Phase 3: Import Pipeline

Duration: 1-2 weeks.

Tasks:

- Build XLSX parser.
- Store upload metadata.
- Normalize rows into staging.
- Implement validation rules.
- Implement row-level error/warning output.
- Implement commit operation.
- Implement duplicate/re-import protection.

Exit criteria:

- Pilot workbook imports into staging.
- Valid rows commit to canonical contract tables.
- Invalid rows remain visible with reasons.

### Phase 4: Purchasing Manager UI

Duration: 1-2 weeks.

Tasks:

- Build contract list/detail.
- Build line editor.
- Build import wizard.
- Build import review table.
- Build product/account match review.
- Build audit trail.
- Add cost visibility controls.

Exit criteria:

- Purchasing Manager can maintain pilot contract pricing in Zeus.
- Spreadsheet round trip is no longer required for pilot scope.

### Phase 5: Quality, Reconciliation, And Reporting

Duration: 1 week.

Tasks:

- Add pricing quality checks.
- Add reconciliation reports.
- Add rejected-row export.
- Add active price export.
- Extend readiness dashboard.

Exit criteria:

- Zeus can prove imported pricing matches or intentionally differs from spreadsheets.
- Pricing blockers are visible and assignable.

### Phase 6: Parallel Run

Duration: 2-4 weeks.

Tasks:

- Run spreadsheet and Zeus side-by-side.
- Import every spreadsheet change.
- Track discrepancies.
- Tune validation and matching.
- Train Purchasing Manager.
- Document pricing SOP.

Exit criteria:

- Zeus data quality meets launch thresholds.
- Purchasing Manager signs off on workflow.
- Management approves Zeus as primary.

### Phase 7: Zeus Primary And Spreadsheet Deprecation

Duration: 1-2 weeks after signoff.

Tasks:

- Enter new pricing in Zeus first.
- Archive legacy spreadsheets.
- Replace manual spreadsheets with Zeus exports.
- Enable production monitoring.
- Optionally prepare Salesforce pushback/warn-only guardrails.

Exit criteria:

- Zeus is canonical for active Contract Pricing.
- Spreadsheets are read-only historical artifacts or Zeus-generated exports.

## 13. Testing Strategy

Unit tests:

- SKU normalization.
- UOM normalization.
- Date parsing.
- Currency parsing.
- Quantity tier validation.
- Overlap detection.
- Price variance detection.
- Role permission checks.
- Pricing calculations.

Integration tests:

- Upload and parse sample workbook.
- Validate mixed good/bad rows.
- Commit batch atomically.
- Re-import duplicate file.
- Manual line edit creates audit row.
- Unauthorized user cannot mutate pricing.

Manual QA:

- Purchasing Manager import walkthrough.
- Contract edit walkthrough.
- Product match resolution walkthrough.
- Reconciliation report review.
- Export review.

Acceptance criteria:

- Known dirty spreadsheet cases are covered by fixtures.
- Build/lint/tests pass before release.
- Pilot import results match expected spreadsheet outputs.

## 14. Operational SOP

Create a simple SOP for the Purchasing Manager:

1. Upload new pricing workbook or create contract manually.
2. Review detected sheets and mapping.
3. Resolve blocked rows.
4. Review warning rows.
5. Commit approved rows.
6. Review reconciliation report.
7. Archive superseded contract lines where needed.
8. Export active pricing only when a spreadsheet artifact is required.

Include escalation rules:

- Product not found: send to product data owner.
- Customer not found: send to Salesforce/account owner.
- Price variance above threshold: require pricing manager confirmation.
- Missing COGS: send to finance/purchasing.
- Overlap conflict: resolve before commit.

## 15. Risks And Mitigations

Risk: spreadsheet formats differ more than expected.

Mitigation: template detection plus staging table preserves unknown columns while mapping matures.

Risk: SKU identity is poor across Salesforce, Fishbowl, and spreadsheets.

Mitigation: product match review queue, aliases, confidence scoring, and no commit for unresolved products.

Risk: Purchasing Manager loses speed compared to Excel.

Mitigation: bulk actions, inline validation, imports first, manual edit shortcuts, and exports for review.

Risk: cost data is too sensitive for broad access.

Mitigation: role-filtered API responses and field-level UI controls.

Risk: historical prices are overwritten.

Mitigation: effective-dated lines, supersede/archive actions, immutable audit table.

Risk: users keep editing spreadsheets after cutover.

Mitigation: read-only archive, Zeus-generated exports, SOP, and a published cutover date.

## 16. Open Decisions

- Which spreadsheets are active and authoritative today?
- Does each row represent contract sell price, buy price/COGS, or both?
- Are contracts customer-specific, customer-group-specific, vendor-specific, global, or mixed?
- What fields are mandatory before a row can be committed?
- Should missing COGS block import, block margin enforcement, or warn only?
- Which users can view `contract_cost` and `product_cogs`?
- What price variance threshold requires extra confirmation?
- What is the cutover date for Zeus Primary?
- What retention period applies to uploaded spreadsheet files?
- Should Zeus exports be allowed after deprecation, and who can generate them?

## 17. Immediate Next Sprint

1. Add `pricing_manager`, `pricing_reviewer`, and `viewer` roles to `src/lib/auth.ts`.
2. Add migration for import file/sheet/row staging and contract line audit.
3. Build a minimal `/api/pricing/imports` upload/parse skeleton.
4. Add deterministic validation service with fixture-based tests.
5. Create a read-only import review page under `/dashboard/pricing/imports/[id]`.
6. Run one pilot spreadsheet through staging only.
7. Review field mapping and validation results with the Purchasing Manager.
8. Convert validated rows into canonical `customer_contracts` and `contract_price_lines`.
9. Add audit output to contract detail.
10. Expand `/api/pricing/readiness` to include import blockers, active contract coverage, and expiring contracts.

