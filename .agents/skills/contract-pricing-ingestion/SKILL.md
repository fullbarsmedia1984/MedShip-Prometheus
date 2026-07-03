\---

name: contract-pricing-ingestion

description: Use this skill when building or modifying Zeus/Prometheus Excel contract-pricing ingestion, workbook discovery, distributor profiles, row validation, dry-run imports, approval workflows, item aliasing, or active negotiated price resolution.

\---



\# Contract Pricing Ingestion Skill



\## Objective



Build a deterministic, auditable Excel ingestion workflow for distributor contract-pricing files.



\## Non-negotiable design principles



1\. The raw spreadsheet is the source of truth.

2\. AI may suggest mappings, but code extracts prices.

3\. Every imported price must be traceable to file, sheet, row, and source column.

4\. Real pricing files must not be committed.

5\. Every import must support dry run before publish.

6\. Exceptions must be first-class workflow objects.

7\. Active pricing must be versioned and reversible.



\## Preferred implementation sequence



1\. Workbook discovery / profiling

2\. Canonical schema and JSON schemas

3\. Distributor ingestion profile format

4\. Profile application engine

5\. Normalization helpers

6\. Validation engine

7\. Dry-run workflow

8\. Exception reporting

9\. Item alias matching

10\. Approval / publish workflow

11\. Active negotiated price resolver

12\. Tests and regression fixtures



\## Workbook discovery output



For each workbook, generate:



\- file name

\- file hash

\- file size

\- workbook format

\- sheet names

\- hidden sheets

\- sheet dimensions

\- used ranges

\- merged cell ranges

\- formula counts

\- hidden rows and columns

\- candidate header rows

\- candidate pricing sheets

\- detected column headers

\- sample non-empty rows

\- likely item identifier columns

\- likely UOM columns

\- likely price columns

\- likely date columns

\- risk flags



\## Distributor profile format



Profiles should be JSON and include:



\- profile name

\- distributor name

\- sheet selection rules

\- header detection rules

\- column mapping rules

\- transforms

\- validations

\- exception rules

\- version

\- notes



\## Required tests



For every parser/profile change, add or update tests covering:



\- header row detection

\- column mapping

\- price parsing

\- UOM normalization

\- row lineage

\- exception generation

\- dry-run output shape



\## Output discipline



When summarizing real files, avoid exposing full price tables. Summaries should focus on structure, counts, headers, confidence, and exception categories.

