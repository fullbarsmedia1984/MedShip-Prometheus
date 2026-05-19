# Zeus Next Start Plan

Date: May 19, 2026

This plan restarts the Salesforce/Fishbowl operational work after the hiatus. Production is currently loading, Salesforce incremental sync is running, and the immediate cleanup is to separate real failures from placeholder automations that were never ready to run.

## Current Findings

- `SF_INCREMENTAL_SYNC` is active and last succeeded on May 19, 2026.
- `P2_INVENTORY_SYNC` last wrote 4,811 inventory rows on May 5, 2026, but finished `partial` because Salesforce Product2 writeback failed during the earlier credential issue.
- `fb_sales_orders` and `fb_sales_order_items` are still empty, so Quotes/Orders cannot yet represent Fishbowl Sales Orders.
- Most current Inngest failures are not credential failures. They are placeholder scheduled jobs:
  - `P3_QB_INVOICE_SYNC`: "Not yet implemented - Phase 3"
  - `P4_SHIPMENT_TRACKING`: "Not yet implemented - Phase 4"
  - `P6_LOW_STOCK_CHECK`: "Not yet implemented - Phase 6"
- No Salesforce or Fishbowl circuit breaker is currently open.
- Salesforce username/password/security-token auth is configured. Connected App client ID/secret are optional for the current login flow.

## Immediate Fixes

1. Disable placeholder Inngest cron triggers for P3, P4, and P6.
2. Mark P3, P4, and P6 inactive/Coming Soon in `sync_schedules`.
3. Keep manual placeholder functions available for future implementation, but do not let them produce scheduled production errors.
4. Update Settings credential display so optional Salesforce client ID/client secret do not look like missing required fields when username-token auth is configured.

## Sprint A: Fishbowl Sales Orders And Salesforce Relationship

Goal: make Fishbowl Sales Orders the canonical quote/order object in Zeus, then relate them back to Salesforce Opportunities.

### Phase 0: Readiness Diagnostics

- Count `fb_sales_orders`, `fb_sales_order_items`, and `opportunity_sales_order_links`.
- Confirm Fishbowl `/api/sales-orders` returns headers and line items through the Cloudflare tunnel.
- Confirm Salesforce custom fields exist on Opportunity, Quote, and Order.
- Confirm active Pricebook and PricebookEntry coverage by Salesforce ProductCode/Fishbowl SKU.

### Phase 1: Relationship Service

Create a dedicated relationship resolver that links Opportunities to Fishbowl Sales Orders from:

- P1 creation result.
- `sf_opportunities.fishbowl_so_number`.
- `sync_events` from `P1_OPP_TO_SO`.
- Fishbowl raw notes or custom fields containing Opportunity IDs.

Likely files:

- `src/lib/fishbowl/sales-order-cache.ts`
- `src/lib/fishbowl/sales-order-links.ts`
- `src/inngest/functions/sf-opportunity-closed.ts`
- `src/inngest/functions/fishbowl-sales-orders-sync.ts`

### Phase 2: P7 Ordering And Pushback

Refactor P7 into explicit steps:

1. Fetch Fishbowl Sales Orders.
2. Cache headers/items in Supabase.
3. Resolve Salesforce Opportunity links.
4. Push Fishbowl SO number, status, issue date, and canonical state back to Salesforce Opportunity.
5. Mirror Salesforce Quote/Order only for linked eligible records.

### Phase 3: Mirror Hardening

- Gate Quote/Order mirror writes behind field readiness or a feature flag.
- Add skip reasons for missing Opportunity, missing Account, missing PricebookEntry, missing product mapping, unsupported Fishbowl status, and line total mismatches.
- Avoid destructive child-line replacement until audit logging and idempotency are proven.

### Phase 4: UI Visibility

- Add relationship health to Settings/Integrations.
- Add linked/unlinked filters to Quotes and Orders.
- Add quote detail line items from `fb_sales_order_items`.

## Sprint B: Pricing Foundation Pilot

Goal: move from a readiness shell to a governed pilot import and calculation workflow. Do not enforce pricing in Salesforce yet.

### Phase 1: Product Crosswalk Generation

- Add SKU normalization helpers.
- Seed `pricing_products` from Salesforce products, Fishbowl inventory, and imported contract SKUs.
- Generate `product_crosswalk` candidates using manual mappings, Salesforce Product2 ID, normalized ProductCode/part number, and imported aliases.
- Surface match statuses: `matched`, `needs_review`, `conflict`, `ignored`, `inactive`.

### Phase 2: Contract Pricing Import Pilot

- Add import staging tables for files, sheets, raw rows, normalized rows, and audit history.
- Build one pilot spreadsheet parser.
- Validate product identity, price, UOM, dates, duplicates, and overlapping effective windows before canonical writes.
- Commit valid rows into `customer_contracts`, `contract_price_lines`, and optional COGS records.

### Phase 3: COGS Source Strategy

Initial source precedence:

1. Contract line cost, if present and effective.
2. Current `product_cogs` record with source `contract`.
3. Fishbowl standard/average cost, if API support is confirmed.
4. Vendor purchase/imported buy price.
5. Manual COGS.
6. Missing COGS, never zero.

### Phase 4: Pricing Calculator And Guardrails

Central formulas:

```text
suggested_retail_price = cost_basis / (1 - target_margin_pct)
minimum_quote_price = cost_basis / (1 - minimum_margin_pct)
gross_margin_dollars = quoted_unit_price - cost_basis
gross_margin_pct = gross_margin_dollars / quoted_unit_price
below_floor = quoted_unit_price < minimum_quote_price
```

Guardrail outcomes:

- Ready
- Below floor
- Missing product
- Missing contract price
- Missing COGS
- Expired contract
- Overlapping contract
- Currency/UOM mismatch

### Phase 5: Pricing UI Expansion

- Keep `/dashboard/pricing` as the command center.
- Add drilldowns for imports, unresolved matches, active contracts, COGS coverage, and pricing quality.
- Keep unsupported write workflows read-only or Coming Soon until roles/RLS are tightened.

## Parallel Workstreams

- Agent A: migrations, pricing services, crosswalk, calculator.
- Agent B: spreadsheet import staging, parser, validation, audit.
- Agent C: pricing UI, import review, match queue, margin calculator shell.
- Agent D: Fishbowl/Salesforce relationship resolver and P7 pushback.
- Agent E: diagnostics, acceptance SQL, data completeness checks, fixtures.

## Acceptance Criteria

- Inngest no longer logs recurring failures for P3/P4/P6 placeholders.
- P2 inventory can be manually run and completes without Salesforce credential failure.
- P7 Fishbowl SO sync populates `fb_sales_orders` and `fb_sales_order_items`.
- At least one Opportunity can be linked to a Fishbowl Sales Order.
- Pricing readiness shows product identity, contract pricing, and COGS blockers with drilldown paths.
- All modules without live backing data remain flagged as Coming Soon or Missing Data.
