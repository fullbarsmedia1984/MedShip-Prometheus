# Contract Pricing Migration Layer

This layer stages reviewed contract-pricing dry-run outputs as supplier contract-cost ingestion batches for Prometheus/Zeus.

Vendor spreadsheet prices are treated as buy-side supplier/distributor costs. They are not customer-facing sell prices and are not written to `customer_contracts` or `contract_price_lines`.

## Lifecycle

1. Run deterministic Excel discovery/profile dry-runs with `pricing_ingestion`.
2. Review exceptions and metadata outside this service.
3. Run migration preflight against a dry-run output directory.
4. Stage only dry-runs that pass preflight.
5. Review staged batches, rows, lineage, and exceptions in Zeus.
6. Approve the batch (blocked while blocking rows or open blocking exceptions exist).
7. Prepare-publish creates pending inactive `supplier_contract_cost_lines` (idempotent replace).
8. Final publish (typed confirmation) activates the pending lines, supersedes prior active
   lines with the same item/UOM identity on the contract, and writes a `publish_batch` audit event.
9. Rollback (typed confirmation) deactivates a published batch's lines, restores the lines it
   superseded via `supersedes_cost_line_id`, and marks the batch `rolled_back`.

Supersede identity is computed in `publish-planner.mjs` (pure, unit-tested): strongest item
identifier (`internal_item_id` → distributor SKU → MPN → model → GTIN → UDI → NDC) plus price
UOM, tier, and minimum quantity. Lines without any identifier activate but never supersede.

## Tables

Migration `020_contract_pricing_migration_layer.sql` creates:

- `pricing_ingestion_batches`
- `pricing_ingestion_rows`
- `pricing_ingestion_exceptions`
- `supplier_contracts`
- `supplier_contract_cost_lines`
- `pricing_publish_events`

Staging never activates cost lines. Only the final publish endpoint sets `active = true`, and it only accepts batches in `publishing` status.

## CLI

Preflight a local dry-run directory:

```bash
node scripts/pricing-contract-migration.mjs preflight --dry-run outputs\pricing_discovery\dry_runs\<run-dir>
```

Stage a clean dry-run directory:

```bash
node scripts/pricing-contract-migration.mjs stage --dry-run outputs\pricing_discovery\dry_runs\<run-dir>
```

Stage requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. It refuses dry-runs with blocking preflight reasons.

`publish` and `rollback` are intentionally not implemented in the CLI: final activation must run through the authenticated dashboard/API flow so the action is attributed to a reviewer and audited.

## API

Read endpoints:

- `GET /api/pricing/contract-migration/batches`
- `GET /api/pricing/contract-migration/batches/[id]`
- `GET /api/pricing/contract-migration/batches/[id]/rows`
- `GET /api/pricing/contract-migration/batches/[id]/exceptions`
- `GET /api/pricing/contract-migration/batches/[id]/publish-preview`
- `GET /api/pricing/supplier-costs/active` — active negotiated cost resolver for Zeus
  (requires at least one scoping filter; effective-date windowed; buy-side only)

Workflow endpoints (admin, audited):

- `PATCH /api/pricing/contract-migration/batches/[id]/exceptions/[exceptionId]`
- `POST /api/pricing/contract-migration/batches/[id]/approve`
- `POST /api/pricing/contract-migration/batches/[id]/prepare-publish`
- `POST /api/pricing/contract-migration/batches/[id]/publish` — requires `confirm: "PUBLISH"`, batch in `publishing` status
- `POST /api/pricing/contract-migration/batches/[id]/rollback` — requires `confirm: "ROLLBACK"`, batch in `published` status

Item matching (Phase B, migration `047_supplier_cost_item_matching.sql`):

- `POST /api/pricing/item-matching/sync-spine` — seed/refresh the internal item spine
  (`pricing_products` + `product_crosswalk`) from the Fishbowl part master in `inventory_snapshot`.
- `GET/POST /api/pricing/contract-migration/batches/[id]/match-suggestions` — list / generate
  deterministic suggest-only item matches (GTIN, SKU, MPN, model) against the internal spine
  and the Hercules catalog. Suggest-only: nothing links without review.
- `PATCH /api/pricing/item-matching/matches/[matchId]` — approve/reject. Approval sets
  `internal_item_id` (internal target) or `hercules_catalog_item_id` (Hercules target) on the
  cost line and supersedes the line's other open suggestions for that target type.

Unmatched cost lines are allowed and never block staging, approval, or publish — matching is retroactive.

Local/dev preflight endpoint:

- `POST /api/pricing/contract-migration/preflight`

Production should register uploaded artifacts instead of accepting arbitrary filesystem paths.

## UI

Initial dashboard routes:

- `/dashboard/pricing/imports`
- `/dashboard/pricing/imports/[id]`
- `/dashboard/pricing/exceptions`

The batch detail UI exposes Approve, Prepare Costs, Publish, and Roll Back. Publish and rollback require typed confirmation (`PUBLISH` / `ROLLBACK`) and show the impact summary before confirming.

## Security Rules

- Do not commit raw workbooks.
- Do not commit generated dry-run outputs containing real values.
- Do not print prices, item descriptions, identifiers, account numbers, contract numbers, or full rows in logs or reports.
- Preserve source file, workbook hash, sheet name, source row, source column map, and source cell map.
- Do not calculate each prices.
- Do not infer package conversions.
- Never activate supplier costs outside the final publish endpoint; publish requires an
  explicit typed confirmation and a batch in `publishing` status.
- Customer sell-pricing tables (`customer_contracts`, `contract_price_lines`) are never read or written by this layer.
