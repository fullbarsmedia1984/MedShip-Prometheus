# Contract Pricing Ingestion Profiles

Profiles describe how deterministic code should parse a family of supplier pricing workbooks.
They are structural configuration only. Do not store row-level prices, account numbers,
contract numbers, secrets, or copied workbook data in profile JSON.

## Lifecycle

1. `draft`: early profile under development.
2. `review_required`: profile can run dry runs but needs human review.
3. `approved`: reviewed profile allowed for controlled dry-run/publish workflows.
4. `deprecated`: no longer used for new workbooks.

Profiles created during pilot work should remain `review_required` until the Purchasing
Manager or data owner reviews mappings, exceptions, and sample dry-run summaries.

## Validation

Validate one profile:

```bash
python -m pricing_ingestion.profiles.validate --profile pricing_ingestion\profiles\<profile>.json
```

Validate every profile:

```bash
python -m pricing_ingestion.profiles.validate --all --profiles-dir pricing_ingestion\profiles
```

Validation checks profile shape plus semantic safety rules such as duplicate mappings,
unsupported transforms, invalid regular expressions, missing price/description mappings,
and missing item identifier mappings.

## Matching Workbooks

Profiles match workbooks using deterministic metadata:

- filename patterns
- sheet-name patterns
- required/optional/forbidden headers
- minimum match score

Filename matches are useful because vendor names are commonly embedded in source file
names, but eligibility must still be based on sheet/header/data-region structure.

## Versioning

Use semantic profile versions such as `1.0.0`. Increment:

- patch for notes or nonbehavioral metadata changes
- minor for mapping or validation changes that remain backward-compatible
- major for workbook family changes or behavior that can alter extracted rows

## Keep Out Of Profiles

- actual prices
- row-level source data
- real account numbers
- real contract numbers
- copied spreadsheet rows
- secrets or supplier portal credentials
