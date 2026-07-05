# Contract Pricing Migration Layer

This layer stages reviewed contract-pricing dry-run outputs as supplier contract-cost ingestion batches for Prometheus/Zeus.

Vendor spreadsheet prices are treated as buy-side supplier/distributor costs. They are not customer-facing sell prices and are not written to `customer_contracts` or `contract_price_lines`.

## Lifecycle

1. Run deterministic Excel discovery/profile dry-runs with `pricing_ingestion`.
2. Review exceptions and metadata outside this service.
3. Run migration preflight against a dry-run output directory.
4. Stage only dry-runs that pass preflight.
5. Review staged batches, rows, lineage, and exceptions in Zeus.
6. Publish is intentionally deferred and not implemented in this phase.

## Tables

Migration `020_contract_pricing_migration_layer.sql` creates:

- `pricing_ingestion_batches`
- `pricing_ingestion_rows`
- `pricing_ingestion_exceptions`
- `supplier_contracts`
- `supplier_contract_cost_lines`
- `pricing_publish_events`

`supplier_contract_cost_lines` is prepared for future approved cost publishing, but staging does not activate cost lines.

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

`publish` and `rollback` are intentionally not implemented.

## API

Read endpoints:

- `GET /api/pricing/contract-migration/batches`
- `GET /api/pricing/contract-migration/batches/[id]`
- `GET /api/pricing/contract-migration/batches/[id]/rows`
- `GET /api/pricing/contract-migration/batches/[id]/exceptions`

Local/dev preflight endpoint:

- `POST /api/pricing/contract-migration/preflight`

Production should register uploaded artifacts instead of accepting arbitrary filesystem paths.

## UI

Initial dashboard routes:

- `/dashboard/pricing/imports`
- `/dashboard/pricing/imports/[id]`
- `/dashboard/pricing/exceptions`

The UI is staging/review-only. Approval and publish controls are disabled.

## Security Rules

- Do not commit raw workbooks.
- Do not commit generated dry-run outputs containing real values.
- Do not print prices, item descriptions, identifiers, account numbers, contract numbers, or full rows in logs or reports.
- Preserve source file, workbook hash, sheet name, source row, source column map, and source cell map.
- Do not calculate each prices.
- Do not infer package conversions.
- Do not activate supplier costs until a future approved publish workflow exists.
