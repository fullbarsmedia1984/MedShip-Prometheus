# Contract Pricing Workbook Discovery

This package performs deterministic discovery for supplier contract-pricing workbooks.
It profiles workbook structure only. It does not import prices into Prometheus, call the
OpenAI API, write Zeus product costs, or mutate Salesforce/Fishbowl data.

Real distributor spreadsheets are expected to vary by vendor. The vendor name is often
only available from the file name, and some workbooks split product categories across
separate sheets or tabs. Treat discovery as workbook-specific profiling before creating
any ingestion profile.

## Local Setup

From the repository root, install the Python dependencies used by the discovery tooling:

```bash
python -m pip install -r requirements.txt
```

Run the discovery tests:

```bash
python -m unittest pricing_ingestion.tests.test_discovery
```

Run discovery against the local raw pricing folder:

```bash
python -m pricing_ingestion.discovery.discover --input data\pricing\raw --manifest data\pricing\manifest.csv --output outputs\pricing_discovery
```

Analyze generated discovery outputs:

```bash
python -m pricing_ingestion.discovery.analyze --input outputs\pricing_discovery --output outputs\pricing_discovery
```

Validate one ingestion profile:

```bash
python -m pricing_ingestion.profiles.validate --profile pricing_ingestion\profiles\<profile>.json
```

Validate all ingestion profiles:

```bash
python -m pricing_ingestion.profiles.validate --all --profiles-dir pricing_ingestion\profiles
```

Run a single-workbook dry run:

```bash
python -m pricing_ingestion.dry_run.run --workbook data\pricing\raw\<workbook>.xlsx --profile pricing_ingestion\profiles\<profile>.json --manifest data\pricing\manifest.csv --output outputs\pricing_discovery\dry_runs\<profile>
```

Dry runs are review artifacts only. They do not publish active prices, write to the
database, or perform item alias matching.

Review pilot dry-run exceptions:

```bash
python -m pricing_ingestion.review.exceptions --dry-run-root outputs\pricing_discovery\dry_runs --output outputs\pricing_discovery\pilot_review
```

Generate the local business-decision packet:

```bash
python -m pricing_ingestion.review.decisions generate --review-root outputs\pricing_discovery\pilot_review --dry-run-root outputs\pricing_discovery\dry_runs --profiles-dir pricing_ingestion\profiles --output data\pricing\business_decisions.local.json
```

Validate the local business-decision file:

```bash
python -m pricing_ingestion.review.decisions validate --decisions data\pricing\business_decisions.local.json
```

The review command generates aggregate-only decision and readiness reports. It may read
ignored machine-readable dry-run files locally, but Markdown outputs must not include
prices, item identifiers, item descriptions, account numbers, contract numbers, or full
source rows.

## File Placement

Place real supplier files under:

```text
data/pricing/raw/
```

That folder is gitignored. Keep real workbooks, PDFs, exports, and generated discovery
outputs out of git. The discovery tool can optionally read:

```text
data/pricing/manifest.csv
```

The manifest may include columns such as `file_name`, `supplier`, `source`, or notes.
Rows are matched to workbooks by file name when possible.

## Run Discovery

From the repository root:

```bash
python -m pricing_ingestion.discovery.discover --input data/pricing/raw --manifest data/pricing/manifest.csv --output outputs/pricing_discovery
```

Use a Python environment with `openpyxl` installed for `.xlsx` and `.xlsm` files.
Legacy `.xls` files are detected but not parsed by default; add an `xlrd`-backed adapter
later if `.xls` profiling becomes required.

## Outputs

The discovery output directory contains:

- `profiles/*.pricing_discovery.json`: one structural profile per workbook.
- `workbook_inventory.csv`: one row per workbook with hashes, sizes, sheet counts, and risk flags.
- `sheet_inventory.csv`: one row per sheet with dimensions, used ranges, formulas, hidden rows/columns, and pricing-sheet scores.
- `candidate_headers.csv`: candidate header rows and matched label categories.
- `risk_report.md`: workbook and sheet-level structural risks.
- `discovery_summary.md`: high-level run summary.

The analysis command reads those deterministic discovery files and adds:

- `discovery_analysis.md`: executive summary, risk totals, limitations, and next-phase recommendation.
- `template_families.csv`: workbook clusters grouped by deterministic sheet/header/risk structure.
- `header_synonyms.csv`: observed header terms mapped conservatively to canonical fields.
- `recommended_profile_backlog.csv`: prioritized profile families to build first.
- `profile_build_plan.md`: implementation plan for the first profile families.
- `pilot_profile_selection.md`: eligibility summary for selected pilot families.

Use `template_families.csv` to decide which workbooks can share a distributor profile.
The `likely_required_profile_complexity` column separates low, medium, and high
complexity candidates. Low-complexity families usually have clear pricing sheets,
header rows, price columns, UOM columns, and item identifiers. Medium families may
need sheet/category rules or merged-cell handling. High-complexity families need
manual review before profile work.

Use `recommended_profile_backlog.csv` as the implementation queue. Start with rows
marked `recommended_now`, confirm the inferred distributor names from file names,
then create sanitized fixtures and profile JSON before writing extraction logic.
Rows marked `blocked_adapter_gap` need a format decision before implementation.

Profile validation and dry-run outputs add:

- `proposed_rows.csv`: machine-readable proposed rows with source lineage. This may
  contain real parsed values and must stay in ignored output directories.
- `exceptions.csv`: machine-readable blocking exceptions and warnings with redacted
  raw-value summaries.
- `dry_run_summary.json`: aggregate counts for automation.
- `dry_run_summary.md`: aggregate-only human summary with no raw prices.
- `mapping_review.md`: field-to-source mapping review with no row-level prices.
- `excluded_rows.csv`: skipped repeated headers, totals/subtotals, or hidden rows.

Pilot review outputs add:

- `exception_review_summary.md`: aggregate exception counts by run.
- `uom_review.csv`: distinct UOM tokens and aggregate counts for review.
- `profile_decision_matrix.csv`: explicit pending business decisions.
- `detecto_variant_analysis.md`: aggregate comparison of Detecto workbook variants.
- `profile_readiness.md`: profile readiness classification by run.

Business review outputs add:

- `business_review_packet.md`: human review packet with required decisions and aggregate evidence.
- `detecto_price_presence.csv`: aggregate missing-price classifications for Detecto.
- `price_basis_candidates.csv`: price-like source headers and counts, without price values.
- `identifier_candidates.csv`: identifier header semantics and pattern counts, without identifier values.
- `uom_decision_template.csv`: UOM review template for human decisions.
- `duplicate_review.csv`: duplicate exception counts by run.
- `metadata_completeness.csv`: manifest metadata presence/absence only.
- `detecto_manual_row_locations.csv`: row locations for manual review without row values.

JSON profiles include sheet names, hidden sheets, dimensions, used ranges, merged ranges,
formula counts, candidate headers, likely SKU/MPN/description/UOM/price/date columns, and
small redacted sample rows. Values in likely price columns are replaced with
`<redacted_price_value>`.

## Commit Rules

Commit source code, schemas, README files, and synthetic fixtures only.

Do not commit:

- real supplier pricing files;
- raw workbook exports;
- generated discovery profiles from real files;
- generated discovery analysis reports from real files;
- price row exports;
- secrets, supplier portal credentials, or Hercules credentials.

Synthetic/sanitized test workbooks are allowed when they contain no real supplier pricing.

Profiles require human approval before production use. Pilot profiles should remain
`review_required` until a reviewer confirms price basis, item identity, UOM/pack-size
semantics, and manifest metadata expectations.
