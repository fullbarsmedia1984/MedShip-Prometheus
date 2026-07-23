# Contract Pricing in Zeus — SOP and User Guide

**Audience:** Purchasing Manager (and anyone managing negotiated supplier costs)
**Scope:** Buy-side contract pricing — the costs we have negotiated with suppliers and distributors.
**Out of scope:** Customer sell pricing. Nothing in this workflow reads or changes customer prices.

**Zeus is the system of record for negotiated supplier costs.** Day-to-day pricing management
happens directly in Zeus tables — the **Contract Price Manager**. Excel is not part of the
workflow: a distributor's spreadsheet is only a *one-time on-ramp* used to load their pricing
into Zeus (and occasionally to bulk-load a full revised list). Once a supplier's pricing is in
Zeus, there is no spreadsheet to maintain, ever.

---

## 1. The big picture

There are two ways pricing data enters or changes in Zeus:

1. **Directly in the table (the normal way).** Open the supplier's contract in Contract Price
   Manager and add, correct, or expire cost lines. This covers the everyday reality of
   purchasing: a price negotiated on a call, a correction, a discontinued item.
2. **By importing a price list (the bulk way).** When onboarding a supplier for the first time,
   or when a distributor sends a full revised price list, import the file through the governed
   upload → review → publish pipeline instead of typing hundreds of lines.

Three principles apply to both:

1. **Nothing is ever silently overwritten.** Correcting a cost creates a *new version* and
   keeps the old one as history. Expiring a line keeps it in history. Bulk publishes can be
   rolled back.
2. **The computer extracts, people decide.** Imports read prices exactly as written (no
   guessing, no unit conversions); column mappings and item matches are suggestions until a
   person approves them.
3. **Everything is traceable.** Every cost records where it came from — the workbook file,
   sheet, row, and cell for imports; the person and timestamp for manual entries — and who
   approved every change.

### Key terms

| Term | Meaning |
| --- | --- |
| **Contract** | One supplier relationship's pricing agreement in Zeus, holding its cost lines. Created automatically at first import; visible in Contract Price Manager. |
| **Cost line** | One negotiated cost: item + unit of measure + price + effective window. |
| **Active cost line** | The official current cost — the answer Zeus gives when asked "what do we pay for this?" |
| **Version / Superseded** | When a cost is corrected or re-imported, the new line supersedes the old one. Old versions stay visible under the Superseded filter. |
| **Expire** | End a cost line without a replacement (discontinued item, lapsed deal). Kept in history. |
| **Batch** | One imported price list moving through review — only relevant during imports. |
| **Profile** | A saved column mapping for one distributor's workbook layout, reused on re-imports. |
| **Exception** | A flagged problem on an imported row (e.g., a price cell that says "call for pricing"). |
| **Item matching** | Linking a cost line to a known catalog item. Suggestion-first, human-approved. |

---

## 2. Access

- You need an **admin** account with two-factor authentication enabled.
- All screens live under **Pricing** in the left menu:
  - **Contract Price Manager** — the day-to-day home: contracts and their cost-line tables.
  - **Supplier Cost Imports** — the import pipeline (onboarding and bulk updates).
  - **Supplier Cost Exceptions** — the exception queue for imported rows.
- Every page has a **?** button in the top bar with a step-by-step guide, and a "What's new"
  popup appears once whenever a workflow changes.

---

## 3. Routine cadence

| When | What to do | Time |
| --- | --- | --- |
| A price changes (call, email, renegotiation) | Edit the line in Contract Price Manager — Workflow 1. | 2 min |
| A new item is negotiated outside a price list | Add the line in Contract Price Manager — Workflow 1. | 2 min |
| An item is discontinued | Expire the line — Workflow 1. | 1 min |
| A distributor sends a full price list | Import it — Workflows 2–5. | 15–45 min |
| Daily or every other day | Quick check of Supplier Cost Imports for in-flight batches, open exceptions, open match suggestions. | 5 min |
| Monthly | Check the "Expiring / Expired" counter in Contract Price Manager and work anything flagged "Expires in Nd" or "Expired" — start renewals before pricing lapses. Zeus does not yet send email alerts. | 15 min |
| After any bulk publish | Spot-check a handful of published lines against the original workbook. | 10 min |

---

## 4. Workflow 1 — Day-to-day: manage costs in the table

**Where:** Pricing → **Contract Price Manager** → open the supplier's contract.

The table shows the contract's cost lines. The **Active** filter (default) is what Zeus
considers the current negotiated costs; **Superseded** and **All** show history.

### Look up a cost

Open the contract and find the line — identifier, description, UOM, cost, effective window,
where it came from (imported file and row, or manual entry), and whether it's matched to a
catalog item.

### Add a cost line (price negotiated without a price list)

1. Click **Add Line**.
2. Enter at least one identifier (SKU, manufacturer part number, model, or GTIN), the
   **cost**, and the **price UOM** (usually `EA`). Add a description so others recognize it.
3. Set the effective date (defaults to today) and, if known, the expiration date.
4. Click **Add Cost Line**. It is active immediately and recorded under your name.

### Correct a cost line

1. Click **Edit** on the line, fix what's wrong (cost, UOM, dates, description).
2. Click **Save New Version**. The corrected line becomes active; the old one moves to
   Superseded history automatically. You never lose sight of what the cost used to be.

### Expire a cost line

1. Click **Expire** on the line, then **Confirm Expire**.
2. The line stops being an active cost but stays in history. Use this for discontinued items
   or lapsed pricing with no replacement.

> **Never keep a side spreadsheet.** If you catch yourself noting a price in Excel "for now,"
> put it in the table instead — it takes the same two minutes and it's the copy everyone sees.

---

## 5. Workflow 2 — Import a price list (onboarding or bulk update)

**Trigger:** onboarding a new supplier, or a distributor sends a full revised price list.

1. Go to **Pricing → Supplier Cost Imports** and click **Upload Workbook**.
2. Fill in the form. Three fields are required: **Distributor name** (same spelling every
   time), **Contract number**, **Effective date**. Add expiration date, account number, and
   location when known.
3. Choose the file (.xlsx) and click **Upload and Analyze**.

### First import for this distributor: build the profile

4. In the **Column Mapping** card, check the sheet and header row Zeus detected.
5. Confirm each suggested mapping (does column D really contain the contract price?).
   **Price is required.** No unit-of-measure column? Set a **Default price UOM** (usually `EA`).
6. Click **Save Profile** (versions increment automatically on later fixes).

### Re-import for a known distributor

Pick their saved profile in the Dry Run card. Only rebuild the mapping if their layout changed —
the dry run makes that obvious.

### Dry run and stage

7. Select the profile, click **Run Dry Run**, and read the counts (valid / warning / blocking).
8. Blocking reasons are listed in plain language: a wrong mapping → fix it and save a new
   profile version; genuine workbook problems → request a corrected file.
9. When clean, click **Stage Batch** and continue with Workflow 3.

---

## 6. Workflow 3 — Review and approve an imported batch

1. On the batch page, check the counts: rows, valid, warning, blocking.
2. Work each open exception: **Resolve** (fixed/verified), **Waive** (acceptable — note why),
   or **Ack** (deferred). Notes are recorded with your name.
3. With no blocking rows and no open exceptions, click **Approve** (a recorded decision — it
   does not publish anything yet).

---

## 7. Workflow 4 — Item matching (any time; never blocks anything)

1. In the batch's **Item Matching** card, click **Generate Suggestions**.
2. Each suggestion shows your spreadsheet line and the suggested catalog item side by side.
3. Decide in order: **compare the part numbers first** (the suggestion exists because they
   match exactly), then sanity-check the descriptions — different systems word things
   differently; they just need to clearly be the same kind of product from the same
   manufacturer.
4. **Approve** when both hold; **Reject** when the descriptions clearly disagree; **not sure —
   leave it open**. Unmatched lines are normal and never block anything.

---

## 8. Workflow 5 — Publish an imported batch (make the costs official)

1. On the approved batch, click **Prepare Costs**, then check the **Publish Preview** (pending
   candidates; open exceptions 0; blocking rows 0; "Sell Pricing: No").
2. Click **Publish**, read the impact summary (how many lines activate, how many current
   lines are superseded), type `PUBLISH`, confirm.
3. The new costs are live in Contract Price Manager; superseded versions move to history
   automatically.

**Undo:** open the published batch, click **Roll Back**, type `ROLLBACK`. Every line from the
batch is deactivated and the previously superseded lines are restored — the exact pre-publish
state, fully recorded.

---

## 9. Rules and guardrails

- **Customer sell pricing is never touched.** This module is supplier costs only.
- **The table is the truth.** After a supplier is onboarded, their Excel file is history — no
  parallel spreadsheets, no "working copies."
- **History is sacred.** Corrections version; expiries archive; publishes supersede; rollbacks
  restore. Nothing is deleted or silently overwritten.
- **Contract number and effective date are required at upload** — staging is blocked without them.
- **Don't guess on matches.** An open suggestion costs nothing; a wrong approval pollutes the
  catalog link.
- **One distributor, one spelling.** Consistent names keep contracts and profiles organized.

---

## 10. Troubleshooting

| What you see | What it means | What to do |
| --- | --- | --- |
| Can't find a supplier in Contract Price Manager | That supplier has never been imported | Onboard them: import their price list (Workflow 2), or if they have only a handful of items, create the contract via a first import and manage the rest in the table. |
| "Only active approved cost lines can be updated" | The line is already superseded or expired | Switch the filter to Active and edit the current version of that item's line. |
| "At least one item identifier is required" | Manual line has no SKU/MPN/model/GTIN | Enter whichever identifier the supplier uses — costs must be attachable to an item. |
| "Only .xlsx and .xlsm workbooks are supported" | The file is an old .xls, CSV, or PDF | Save as .xlsx in Excel, or request an Excel version. |
| Dry run shows many blocking rows | Usually a wrong column mapping or header row | Re-check the mapping, save a new profile version, re-run. |
| "Missing price UOM" blocking reason | No unit-of-measure column and no default set | Set Default price UOM in the profile (usually `EA`), save, re-run. |
| "Batches with blocking rows cannot be approved" | Blocking rows still present | Fix at the dry-run stage — approval never overrides blocking rows. |
| Publish button is disabled | Batch not ready | Follow the order: Approve → Prepare Costs → Publish; the preview lists blockers. |
| A published price is wrong | Bad data or wrong mapping made it through | Single line → Edit it in Contract Price Manager. Whole batch → Roll Back, fix, re-import. |
| Page or button missing entirely | Account role or an in-progress deployment | Confirm the admin role; check "What's new"; contact the administrator. |

---

## 11. Getting help

- Click the **?** button on any pricing page for that page's step-by-step guide.
- The **"What's new" popup** explains changes after every update.
- For anything unexpected, copy the exact error text and send it to the system administrator —
  exact wording makes fixes fast.

---

*This SOP describes the Zeus contract-pricing module as deployed. When workflows change, the
in-app guides and changelog are updated in the same release; this document should be revised to
match.*
