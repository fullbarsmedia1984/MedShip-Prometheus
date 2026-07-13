# Zeus / Prometheus Contract Pricing Ingestion Instructions

## Project goal

Build a governed contract-pricing ingestion workflow for distributor Excel pricing sheets.

The system must ingest inconsistent Excel files, discover workbook structure, propose column mappings, parse rows deterministically, validate rows, preserve source lineage, support dry-run review, and publish only approved prices.

## Critical rules

- Never commit real distributor pricing spreadsheets.
- Never commit generated files containing real prices.
- Raw files live under `data/pricing/raw/` and must remain gitignored.
- Sanitized test fixtures may live under `pricing_ingestion/tests/fixtures/`.
- The source spreadsheet remains the source of truth.
- ChatGPT/OpenAI may assist with schema discovery and mapping suggestions.
- Actual price extraction must be deterministic code, not free-form model output.
- Every parsed price row must preserve source lineage:
  - source file
  - workbook hash
  - sheet name
  - row number
  - source column names
  - source cell references where practical
- Imports must support dry run before publish.
- No price becomes active without explicit approval logic.
- Add tests for every parser, validator, and profile rule.
- Prefer simple, inspectable code over clever heuristics.

## Required canonical fields

At minimum, normalized rows should support:

- distributor_id or distributor_name
- contract_name
- contract_number
- account_number
- location
- internal_item_id
- distributor_sku
- manufacturer_name
- manufacturer_part_number
- item_description_raw
- raw_uom
- normalized_uom
- pack_size
- price
- currency
- effective_date
- expiration_date
- source_file
- source_file_hash
- source_sheet_name
- source_row_number
- source_column_map
- ingestion_batch_id
- validation_status
- exception_reasons
- confidence_score

## Validation rules

Flag these conditions:

- missing price
- invalid price
- price <= 0
- missing UOM
- unknown UOM
- missing item identifier
- missing description
- duplicate item / distributor / contract / UOM row
- conflicting prices for same key
- formula-derived price cell
- hidden row or hidden sheet
- merged-cell ambiguity
- missing effective date
- expired pricing
- large variance versus prior known price, if prior price data exists

## Development expectations

- Build the workbook discovery layer first.
- Do not build the final database import until discovery and dry-run are working.
- Produce machine-readable JSON and CSV reports.
- Keep all command-line scripts runnable from repo root.
- Include README documentation for each workflow.
- Add tests using sanitized fixture files.

## Whole-repository handoff context

Before changing Prometheus outside the contract-pricing ingestion workflow,
read `CODEX.md`. It is the current repository map, source-of-truth guide,
validation baseline, and takeover context.

For Shipping Ops Dashboard, Kit Galaxy, or Nursing Kit Production Manager
work, also read:

- `docs/warehouse-wallboard.md`
- `docs/kit-assembly.md`
- `docs/shipping-ops-kits-audit-2026-07-12.md`

Do not recursively scan `.claude/worktrees/`; it contains ignored nested
worktrees and dependency/build copies that are not part of the active source
tree. Scope repository-wide searches to tracked/authored paths and exclude
`node_modules`, `.next`, outputs, raw data, and nested agent worktrees.
