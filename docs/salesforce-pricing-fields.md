# Salesforce Pricing Admin Guide

This guide defines the Salesforce admin setup required before Zeus can push pricing intelligence back into Salesforce or enforce quote guardrails. It is based on `docs/zeus-pricing-implementation-plan.md` and should be treated as the Salesforce-side contract for the pricing rollout.

Do not enable hard blocking rules until Zeus has acceptable product crosswalk coverage, contract price coverage, COGS coverage, quote/order line coverage, and Medical Shipment approval of margin thresholds.

## Objectives

- Store Zeus-calculated contract pricing, cost basis, target margin, minimum margin, suggested retail, and quote floor values on `Product2`.
- Snapshot pricing values onto `OpportunityLineItem` and `QuoteLineItem` when reps quote.
- Make margin and below-floor status visible to reps and managers.
- Require approval before a below-floor line can be saved, submitted, or mirrored downstream.
- Give Zeus enough Salesforce fields to safely push pricing data back after the fields and permissions exist.

## Admin Prerequisites

- Confirm whether reps quote on Opportunities, Quotes, or both.
- Confirm whether Salesforce CPQ is installed. If CPQ is installed, map the same concepts onto CPQ quote line objects before adding duplicate automation.
- Confirm the active Pricebooks and Product families that are allowed to quote at zero or negative prices, if any.
- Confirm the source of contract pricing and COGS in Zeus before enabling Product2 pushback.
- Create a pricing admin permission set before field rollout so restricted cost fields are not exposed broadly.

## Product2 Fields

Create these fields on `Product2`.

| Field Label | API Name | Type | Visibility | Purpose |
| --- | --- | --- | --- | --- |
| Contract Price | `Contract_Price__c` | Currency | Sales, managers, pricing admins | Current Zeus-resolved contract sell price or base price for the product. |
| Cost Basis | `Cost_Basis__c` | Currency | Pricing admins and approved managers only | Current cost basis used for margin calculations. Restrict from general sales visibility. |
| Target Margin % | `Target_Margin_Pct__c` | Percent | Sales, managers, pricing admins | Margin Zeus recommends using for suggested retail. |
| Minimum Margin % | `Minimum_Margin_Pct__c` | Percent | Sales, managers, pricing admins | Minimum acceptable margin before approval is required. |
| Suggested Retail Price | `Suggested_Retail_Price__c` | Currency | Sales, managers, pricing admins | Zeus-calculated recommended quote price. |
| Minimum Quote Price | `Minimum_Quote_Price__c` | Currency | Sales, managers, pricing admins | Zeus-calculated quote floor. |
| Pricing Last Verified | `Pricing_Last_Verified__c` | Date/Time | Sales, managers, pricing admins | Last time Zeus verified or refreshed pricing inputs. |
| Pricing Source | `Pricing_Source__c` | Picklist or Text | Sales, managers, pricing admins | Source used by Zeus, such as contract import, vendor file, Fishbowl, manual override, or unknown. |
| Pricing Approval Required | `Pricing_Approval_Required__c` | Checkbox | Sales, managers, pricing admins | Flags products where quotes below floor must route through approval. |

Recommended `Pricing_Source__c` picklist values:

- `Contract Import`
- `Vendor File`
- `Fishbowl`
- `Manual Zeus Override`
- `Salesforce Manual`
- `Unknown`

Recommended Product page layout changes:

- Add a "Pricing Guardrails" section with contract price, target margin, minimum margin, suggested retail, minimum quote price, source, and last verified.
- Add `Cost_Basis__c` only to layouts assigned to pricing admins and approved managers.
- Make Zeus-owned calculated fields read-only for standard sales users.

## OpportunityLineItem Fields

Create these fields on `OpportunityLineItem`.

| Field Label | API Name | Type | Visibility | Purpose |
| --- | --- | --- | --- | --- |
| Cost Basis At Quote | `Cost_Basis_At_Quote__c` | Currency | Pricing admins and approved managers only | Snapshot of cost basis when the line was priced. |
| Floor Price At Quote | `Floor_Price_At_Quote__c` | Currency | Sales, managers, pricing admins | Snapshot of the quote floor used for guardrail checks. |
| Suggested Retail At Quote | `Suggested_Retail_At_Quote__c` | Currency | Sales, managers, pricing admins | Snapshot of suggested retail when the line was priced. |
| Gross Margin % | `Gross_Margin_Pct__c` | Formula Percent | Sales, managers, pricing admins | Formula margin based on unit price and cost basis snapshot. |
| Below Floor | `Below_Floor__c` | Formula Checkbox | Sales, managers, pricing admins | Formula flag when quoted unit price is below the floor snapshot. |
| Pricing Exception Reason | `Pricing_Exception_Reason__c` | Picklist or Text | Sales, managers, pricing admins | Required explanation when a line breaches margin or floor rules. |
| Pricing Approval Status | `Pricing_Approval_Status__c` | Picklist | Sales, managers, pricing admins | Approval lifecycle state used by validation and Zeus. |

Recommended `Pricing_Approval_Status__c` values:

- `Not Required`
- `Required`
- `Pending`
- `Approved`
- `Rejected`
- `Expired`

Recommended `Pricing_Exception_Reason__c` picklist values:

- `Competitive Match`
- `Strategic Account`
- `Contractual Obligation`
- `Clearance`
- `Data Correction Needed`
- `Manager Approved Exception`
- `Other`

## QuoteLineItem Fields

Create matching fields on `QuoteLineItem` if reps quote using Salesforce Quotes.

| Field Label | API Name | Type | Visibility | Purpose |
| --- | --- | --- | --- | --- |
| Cost Basis At Quote | `Cost_Basis_At_Quote__c` | Currency | Pricing admins and approved managers only | Snapshot of cost basis when the line was priced. |
| Floor Price At Quote | `Floor_Price_At_Quote__c` | Currency | Sales, managers, pricing admins | Snapshot of the quote floor used for guardrail checks. |
| Suggested Retail At Quote | `Suggested_Retail_At_Quote__c` | Currency | Sales, managers, pricing admins | Snapshot of suggested retail when the line was priced. |
| Gross Margin % | `Gross_Margin_Pct__c` | Formula Percent | Sales, managers, pricing admins | Formula margin based on unit price and cost basis snapshot. |
| Below Floor | `Below_Floor__c` | Formula Checkbox | Sales, managers, pricing admins | Formula flag when quoted unit price is below the floor snapshot. |
| Pricing Exception Reason | `Pricing_Exception_Reason__c` | Picklist or Text | Sales, managers, pricing admins | Required explanation when a line breaches margin or floor rules. |
| Pricing Approval Status | `Pricing_Approval_Status__c` | Picklist | Sales, managers, pricing admins | Approval lifecycle state used by validation and Zeus. |

Use the same picklist values as `OpportunityLineItem` unless the Quote process has a separate approval lifecycle.

## Snapshot Automation

Add a before-save record-triggered Flow, Apex trigger, or CPQ price rule that snapshots Product2 pricing values onto line items when the product or pricebook entry changes.

Plain-English logic:

```text
When an OpportunityLineItem or QuoteLineItem is created or its product changes:
  read the related Product2 pricing fields
  set Cost_Basis_At_Quote__c from Product2.Cost_Basis__c
  set Floor_Price_At_Quote__c from Product2.Minimum_Quote_Price__c
  set Suggested_Retail_At_Quote__c from Product2.Suggested_Retail_Price__c

When the unit price changes:
  leave the snapshot values unchanged
  let formula fields recalculate margin and below-floor status

When pricing data is missing:
  set Pricing_Approval_Status__c to Required
  require a pricing exception reason before submission or downstream mirror
```

Snapshot values should preserve the pricing context used at quote time. Do not automatically rewrite existing quote line snapshots after Product2 pricing is refreshed unless Medical Shipment explicitly wants open quotes repriced.

## Formula Pseudocode

Use Salesforce formula syntax during implementation, but keep the business rules aligned with this pseudocode.

Product2 suggested retail:

```text
If Contract_Price__c is blank or Target_Margin_Pct__c is blank:
  Suggested_Retail_Price__c is blank
Else:
  Suggested_Retail_Price__c = Contract_Price__c / (1 - Target_Margin_Pct__c)
```

Product2 minimum quote price:

```text
If Contract_Price__c is blank or Minimum_Margin_Pct__c is blank:
  Minimum_Quote_Price__c is blank
Else:
  Minimum_Quote_Price__c = Contract_Price__c / (1 - Minimum_Margin_Pct__c)
```

Line gross margin percent:

```text
If UnitPrice is blank, UnitPrice is zero, or Cost_Basis_At_Quote__c is blank:
  Gross_Margin_Pct__c is blank
Else:
  Gross_Margin_Pct__c = (UnitPrice - Cost_Basis_At_Quote__c) / UnitPrice
```

Line below floor:

```text
If UnitPrice is blank or Floor_Price_At_Quote__c is blank:
  Below_Floor__c = false
Else:
  Below_Floor__c = UnitPrice < Floor_Price_At_Quote__c
```

Pricing approval required:

```text
If Below_Floor__c is true:
  Pricing_Approval_Status__c should be Required or Pending until approved
Else if required pricing data is missing:
  Pricing_Approval_Status__c should be Required
Else:
  Pricing_Approval_Status__c should be Not Required
```

## Validation Rules

Create equivalent validation rules on both `OpportunityLineItem` and `QuoteLineItem` where the quoting workflow uses both objects.

Below-floor block:

```text
Block save when:
  Below_Floor__c is true
  and Pricing_Approval_Status__c is not Approved

Error message:
  This line is below the minimum quote price. Submit a pricing exception for approval before saving or submitting the quote.
```

Exception reason required:

```text
Block save when:
  Below_Floor__c is true
  and Pricing_Exception_Reason__c is blank

Error message:
  Enter a pricing exception reason for below-floor pricing.
```

Zero or negative price block:

```text
Block save when:
  UnitPrice is zero or negative
  and the related Product2 family/category is not explicitly allowed for zero or negative pricing
  and Pricing_Approval_Status__c is not Approved

Error message:
  Unit price must be greater than zero unless this product is approved for zero or negative pricing.
```

Missing pricebook:

```text
Block save or submission when:
  the parent Opportunity or Quote has no Pricebook2

Error message:
  Select a Price Book before adding priced products.
```

Inactive pricebook entry:

```text
Block save when:
  the line uses a PricebookEntry that is inactive

Error message:
  Select an active price book entry for this product.
```

Missing pricing data warning or block:

```text
During warn-only rollout:
  allow save when floor, cost, or suggested retail is missing
  set Pricing_Approval_Status__c to Required
  show a warning where possible

During enforcement rollout:
  block save or submission when required pricing data is missing
  unless Pricing_Approval_Status__c is Approved
```

## Approval Flow

Use a Salesforce Approval Process, Flow Orchestration, or CPQ approval rule depending on the quoting stack.

Recommended lifecycle:

1. Rep adds or edits a line item.
2. Snapshot automation copies Product2 pricing values onto the line.
3. Formula fields calculate margin and below-floor status.
4. If the line is below floor or missing required pricing data, set `Pricing_Approval_Status__c` to `Required`.
5. Rep enters `Pricing_Exception_Reason__c` and submits for approval.
6. Pricing manager reviews quoted price, floor price, cost basis, margin, account context, and reason.
7. Approver sets status to `Approved` or `Rejected`.
8. Approved exceptions retain approver, timestamp, reason, and status.
9. Zeus reads the status before allowing downstream Fishbowl or Salesforce mirror operations.

Recommended approval assignment:

- Route standard below-floor exceptions to `pricing_manager`.
- Route high-risk exceptions, negative margin, or missing COGS to an admin or senior finance approver.
- Auto-expire approvals when the quote expires, the line product changes, the unit price changes, or Zeus refreshes pricing in a way that changes the floor price materially.

Recommended approval criteria:

```text
Submit for approval when:
  Below_Floor__c is true
  or Gross_Margin_Pct__c is below the configured minimum margin
  or Cost_Basis_At_Quote__c is blank
  or Floor_Price_At_Quote__c is blank
```

## Rollout Order

Follow this order so Salesforce remains usable while data quality catches up.

1. Read-only data audit: verify product codes, Product2 coverage, Fishbowl/Salesforce crosswalks, contract price coverage, COGS coverage, and quote/order line coverage.
2. Create fields and permission sets: add Product2, OpportunityLineItem, and QuoteLineItem fields with restricted cost visibility.
3. Add read-only layouts and reports: expose pricing health without blocking reps.
4. Contract import pilot in Zeus: load a controlled product/account set and validate calculated prices.
5. Snapshot automation in warn-only mode: copy Product2 pricing to lines and report breaches without blocking saves.
6. Approval pilot: route below-floor lines to pricing managers for selected users, teams, or products.
7. Salesforce enforcement: enable validation rules after Medical Shipment signs off on margin thresholds and data readiness.
8. Zeus Product2 pushback: allow Zeus to update Product2 pricing fields only after fields, permissions, audit logging, and reconciliation reports are validated.
9. Downstream mirror enforcement: Zeus refuses Fishbowl/Salesforce mirror operations when pricing status is invalid.

## Zeus Pushback Requirements

Zeus must not push Product2 pricing values until these requirements are met.

Required Salesforce setup:

- Product2 pricing fields exist in production with final API names.
- Line-level snapshot fields exist for every quoting object in use.
- Cost field visibility is restricted through field-level security and page layouts.
- Pricing admin permission set exists.
- Integration user has write access only to Zeus-owned pricing fields.
- Validation and approval flows are tested in sandbox before production activation.

Required Zeus data readiness:

- Product crosswalk coverage meets the launch threshold.
- Contract price coverage meets the launch threshold.
- COGS coverage meets the launch threshold.
- Quote/order line product identity coverage meets the launch threshold.
- Pricing calculations expose source fields and rule version.
- Missing data returns an explicit guardrail result instead of zero or blank defaults.

Required pushback behavior:

- Write only Zeus-owned Product2 pricing fields.
- Do not overwrite manually maintained Salesforce product metadata.
- Include `Pricing_Last_Verified__c` on every successful push.
- Include `Pricing_Source__c` so admins can trace the source of each value.
- Preserve an audit trail in Zeus for source batch, source row, previous value, new value, integration user, and timestamp.
- Detect stale Salesforce records before update and retry or flag conflicts for review.
- Push in batches with failure reporting by Product2 Id and ProductCode.
- Never push `Cost_Basis__c` to profiles that can expose it through field-level security.
- Stop Product2 pushback if coverage drops below threshold or reconciliation finds unexpected drift.

Required downstream enforcement:

- Zeus must evaluate pricing status before Fishbowl or Salesforce mirror operations.
- Zeus must refuse downstream mirror operations when a line is below floor and not approved.
- Zeus must refuse or hold downstream mirror operations when required pricing data is missing during enforcement mode.
- Zeus must record guardrail events for every allowed exception and every blocked operation.

## Admin Reports

Create reports or dashboards for:

- Products missing contract price.
- Products missing cost basis.
- Products with expired or unverified pricing.
- Products with `Pricing_Source__c = Unknown`.
- Quote or opportunity lines below floor.
- Quote or opportunity lines missing approval status.
- Approved pricing exceptions by approver, account, rep, product, and margin.
- Lines with blank product identity or inactive pricebook entries.

## Open Admin Decisions

- Which Salesforce object is the source of truth for quoting: Opportunity Products, Quotes, CPQ Quote Lines, or a mix?
- Which Product families may allow zero or negative pricing?
- What is the default minimum margin by Product family?
- What approval expiration rule should apply after pricing changes?
- Should open quote line snapshots be repriced automatically after Zeus refreshes Product2 pricing?
