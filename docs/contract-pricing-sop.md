# Contract Pricing in Zeus — SOP and User Guide

**Audience:** Purchasing Manager (and anyone managing negotiated supplier costs)
**Scope:** Buy-side contract pricing — the costs we have negotiated with suppliers and distributors.
**Out of scope:** Customer sell pricing. Nothing in this workflow reads or changes customer prices.

Zeus is now the system of record for negotiated supplier costs. Excel price lists are still how
distributors *send* us pricing, but they are no longer where we *keep* it: every workbook is
imported, reviewed, and published inside Zeus, with a full audit trail down to the exact
spreadsheet cell each cost came from.

---

## 1. The big picture

Every supplier price list moves through the same pipeline:

```
Upload workbook  →  Map columns (profile)  →  Dry run  →  Stage
     →  Review exceptions  →  Approve  →  Prepare costs  →  Publish
```

Three principles to keep in mind:

1. **Nothing becomes official by accident.** Costs only become active at the final Publish step,
   which requires typing `PUBLISH` to confirm — and it can always be rolled back.
2. **The computer extracts, people decide.** Zeus reads prices from the workbook exactly as
   written (no guessing, no unit conversions). Column mappings and item matches are only
   *suggestions* until a person approves them.
3. **Everything is traceable.** Every published cost records which file, sheet, row, and cell it
   came from, who approved it, and when.

### Key terms

| Term | Meaning |
| --- | --- |
| **Upload** | A distributor workbook file stored in Zeus, plus its contract details (contract number, effective date, etc.). |
| **Profile** | A saved column mapping for one distributor's workbook layout ("Item # is column A, Contract Price is column D…"). Reused every time that distributor sends an updated list. |
| **Dry run** | A preview extraction. Counts what would import cleanly and what has problems. Changes nothing. |
| **Batch** | One imported price list working its way through review. |
| **Exception** | A flagged problem on an imported row (e.g., a price cell that says "call for pricing"). |
| **Item matching** | Linking an imported line to a known catalog item. Suggestion-first, human-approved. |
| **Pending cost line** | A cost that has been prepared but is not yet official. |
| **Active cost line** | An official negotiated cost — the answer Zeus gives when asked "what do we pay for this?" |
| **Supersede** | When a newly published cost replaces the previous active cost for the same item and unit of measure. The old one is kept for history. |
| **Rollback** | Un-publishing a batch: its costs are deactivated and the previous costs are restored. |

---

## 2. Access

- You need an **admin** account with two-factor authentication enabled.
- All screens live under **Pricing** in the left menu:
  - **Supplier Cost Imports** — the batch list, and the Upload Workbook button.
  - **Supplier Cost Exceptions** — the exception queue across batches.
- Every page has a **?** button in the top bar with a step-by-step guide, and a "What's new"
  popup appears once whenever a workflow changes.

---

## 3. Routine cadence

| When | What to do | Time |
| --- | --- | --- |
| A distributor sends a price list | Run **Workflow A → D** below, end to end. | 15–45 min |
| Daily or every other day | Quick check of **Supplier Cost Imports**: any batch sitting in "needs review"? Any open exceptions or match suggestions on in-flight batches? | 5 min |
| Monthly | Review upcoming **contract expirations** (you entered the expiration date at upload). Set a calendar reminder per contract — Zeus does not yet send expiration alerts. | 15 min |
| After any publish | Spot-check a handful of published lines against the original workbook. | 10 min |

---

## 4. Workflow A — Import a new price list

**Trigger:** a distributor emails an updated Excel price list.

1. Save the attachment somewhere temporary (you can delete it after upload — Zeus keeps the file).
2. Go to **Pricing → Supplier Cost Imports** and click **Upload Workbook**.
3. Fill in the form. Three fields are required and gate everything downstream:
   - **Distributor name** — use the same spelling every time for the same distributor.
   - **Contract number** — from the contract or the distributor's cover email.
   - **Effective date** — when this pricing takes effect.
   Also fill expiration date, account number, and location when you have them.
4. Choose the file and click **Upload and Analyze**. Zeus stores the workbook and detects its
   structure automatically, then opens the workbook page.

### First time for this distributor: build the profile

5. In the **Column Mapping** card, check the sheet and header row Zeus detected (correct them
   if it guessed wrong — the header row is the row containing the column titles).
6. Zeus pre-fills suggested mappings from the column headers. Confirm each one: does column D
   really contain the contract price? Fix anything wrong; leave irrelevant fields "Not mapped."
   **Price is required.** If the workbook has no unit-of-measure column, set a **Default price
   UOM** (usually `EA`).
7. Click **Save Profile**. Profiles are versioned automatically — saving again after a fix
   creates the next version; old versions are kept.

### Returning distributor: reuse the saved profile

If this distributor has sent lists before, skip to the Dry Run card and pick their existing
profile from the dropdown. Only rebuild the mapping if their file layout changed (the dry run
will make that obvious).

### Dry run and stage

8. In the **Dry Run & Stage** card, select the profile and click **Run Dry Run**.
9. Read the counts: **Valid** rows import cleanly; **Warnings** import but are flagged;
   **Blocking** rows have problems that stop the import.
10. If there are blocking reasons, the card lists them in plain language. The two most common:
    - *Wrong column mapped* (e.g., prices are unreadable) → fix the mapping, save a new profile
      version, re-run.
    - *Genuine data problems in the workbook* (e.g., "call for pricing" in a price cell) → ask
      the distributor for a corrected file, or accept that those rows won't import.
11. When the dry run is clean, click **Stage Batch**. The page links to the new batch — continue
    with Workflow B.

---

## 5. Workflow B — Review and approve the batch

On the batch page (also reachable from the Supplier Cost Imports list):

1. Check the counts: rows, valid, warning, blocking.
2. Work the **exception list** on the right. For each open exception choose:
   - **Resolve** — you fixed or verified the underlying issue.
   - **Waive** — the issue is real but acceptable (note why).
   - **Ack** — acknowledged, decision deferred.
   Notes are recorded with your name.
3. When there are no blocking rows and no open exceptions, click **Approve**. Approval is a
   recorded decision — it does not publish anything yet.

---

## 6. Workflow C — Item matching (any time; never blocks publishing)

Matching links imported lines to known catalog items so costs connect to the rest of Zeus. Run
it whenever a batch is staged — before or after publishing, both are fine.

1. In the **Item Matching** card, click **Generate Suggestions**.
2. Each suggestion shows **your spreadsheet line on the left** and the **suggested catalog item
   on the right** — part numbers, manufacturers, and full descriptions.
3. Decide in this order:
   1. **Compare the part numbers.** The suggestion exists because they match exactly.
   2. **Sanity-check the descriptions.** They come from different systems and won't read
      word-for-word the same — they just need to clearly be the same kind of product from the
      same manufacturer.
   3. **Approve** when both hold. **Reject** when the descriptions clearly disagree (your line
      is a scale, the suggestion is a cart). **Not sure? Leave it open** and move on.
4. Unmatched lines are normal — many supplier catalog items aren't things we stock. They never
   block anything.

---

## 7. Workflow D — Publish (make the costs official)

1. On the approved batch page, click **Prepare Costs**. This creates *pending* cost lines —
   still not official.
2. Check the **Publish Preview** numbers: pending candidates, open exceptions (0), blocking
   rows (0), and "Sell Pricing: No."
3. Optionally spot-check a few rows against the original workbook.
4. Click **Publish**. Read the impact summary — it states exactly how many lines will activate
   and how many currently active lines will be replaced (superseded).
5. Type `PUBLISH` and confirm.
6. The batch status changes to **published**. These are now the active negotiated costs, and
   any previous costs for the same item and unit of measure on this contract are superseded
   automatically — you never need to hunt down and retire old lines by hand.

**Publishing an updated list from the same distributor** is the same flow: upload the new file
(Workflow A, reusing the profile), stage, approve, publish. The new lines supersede the old ones.

---

## 8. Workflow E — Rollback (undo a publish)

If anything about a published batch turns out to be wrong:

1. Open the published batch and click **Roll Back**.
2. Read the summary: every cost line from this batch will be deactivated, and the lines it
   superseded will be restored.
3. Type `ROLLBACK` and confirm.

Rollback is safe and complete — the system returns to exactly the state before the publish, and
the whole event is recorded. Fix the underlying problem, then re-import and publish again.

---

## 9. Rules and guardrails

- **Customer sell pricing is never touched.** This module is supplier costs only.
- **Never activate costs outside the Publish button.** There is no other supported path.
- **Contract number and effective date are required at upload** — no exceptions; staging is
  blocked without them.
- **Don't guess on matches.** An open suggestion costs nothing; a wrong approval pollutes the
  catalog link. When unsure, leave it open and ask.
- **One distributor, one spelling.** Consistent distributor names keep profiles and contracts
  organized.
- **After cutover, the Excel file is history, not a working copy.** Once a distributor's
  pricing is published in Zeus, do not maintain a parallel spreadsheet.

---

## 10. Troubleshooting

| What you see | What it means | What to do |
| --- | --- | --- |
| "Only .xlsx and .xlsm workbooks are supported" | The file is an old `.xls`, a CSV, or a PDF | Open it in Excel and save as `.xlsx`, or ask the distributor for an Excel version. |
| Dry run shows many blocking rows | Usually a wrong column mapping or wrong header row | Re-check the mapping (is Price really that column? is the header row right?), save a new profile version, re-run. |
| "Missing price UOM" blocking reason | The workbook has no unit-of-measure column and no default was set | Set **Default price UOM** in the profile (usually `EA`), save, re-run. |
| "Batches with blocking rows cannot be approved" | Blocking rows are still present | Fix at the dry-run stage (Workflow A step 10) — approval never overrides blocking rows. |
| "Open blocking exceptions must be resolved or waived" | Exceptions still open on the batch | Work the exception list (Workflow B step 2). |
| Publish button is disabled | Batch isn't ready — not approved, costs not prepared, or preview shows blockers | Follow the order: Approve → Prepare Costs → Publish. The preview lists any blockers. |
| "Batch is already published" | Someone already published it | Nothing to do — check the batch status. |
| A published price is wrong | Bad data or wrong mapping made it through | **Roll Back** the batch, fix, re-import, re-publish. |
| Page or button missing entirely | Account role or an in-progress deployment | Confirm your account has the admin role; check the "What's new" popup; contact the administrator. |

---

## 11. Getting help

- Click the **?** button on any pricing page for that page's step-by-step guide.
- The **"What's new" popup** explains changes after every update — it appears once per change.
- For anything unexpected, copy the exact error text and send it to the system administrator —
  exact wording makes fixes fast.

---

*This SOP describes the Zeus contract-pricing module as deployed. When workflows change, the
in-app guides and changelog are updated in the same release; this document should be revised to
match.*
