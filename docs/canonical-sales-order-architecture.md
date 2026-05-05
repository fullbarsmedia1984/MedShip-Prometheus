# Canonical Quote and Order Architecture

Prometheus treats Salesforce Opportunities as pipeline records and Fishbowl Sales Orders as the operational source of truth for quoted and ordered product lines.

## Lifecycle

1. Salesforce Opportunity tracks the sales pursuit.
2. Prometheus P1 creates or links a Fishbowl Sales Order in a quote-like state.
3. Prometheus P7 pulls Fishbowl Sales Orders into `fb_sales_orders` and `fb_sales_order_items`.
4. Fishbowl Sales Orders that are not issued appear in `canonical_quotes`.
5. Fishbowl Sales Orders that are issued or further along appear in `canonical_orders`.
6. Salesforce Quote and Order records should mirror the Fishbowl SO state once the custom fields below exist.

## Salesforce Custom Fields Needed

Create these before enabling Salesforce Quote/Order writes:

| Object | Field API Name | Type | Notes |
| --- | --- | --- | --- |
| Opportunity | `Fishbowl_SO_Number__c` | Text 80 | Existing code already reads/writes this field. |
| Quote | `Fishbowl_SO_Number__c` | Text 80 | Mark as External ID and Unique if allowed. |
| Quote | `Fishbowl_SO_Status__c` | Text/Picklist | Mirrors Fishbowl SO status. |
| Quote | `Prometheus_Canonical_Id__c` | Text 36 | Stores `fb_sales_orders.id`. |
| Order | `Fishbowl_SO_Number__c` | Text 80 | Mark as External ID and Unique if allowed. |
| Order | `Prometheus_Canonical_Id__c` | Text 36 | Stores `fb_sales_orders.id`. |
| Order | `Quote__c` | Lookup(Quote) | Recommended if the org does not already relate Order to Quote. |
| Order | `Opportunity__c` | Lookup(Opportunity) | Needed if standard Order opportunity linkage is unavailable. |

## Prometheus Tables

- `fb_sales_orders`: Fishbowl SO headers, status, totals, customer, dates, Salesforce linkage.
- `fb_sales_order_items`: Fishbowl SO line items with product, quantity, and price.
- `opportunity_sales_order_links`: explicit Opportunity-to-SO relationship/audit table.
- `canonical_quotes`: view over Fishbowl SOs in quote state.
- `canonical_orders`: view over Fishbowl SOs in issued/order state.

## Automation Ownership

- `P1_OPP_TO_SO`: creates/links a Fishbowl SO quote from an Opportunity.
- `P7_FB_SO_SYNC`: pulls all Fishbowl SOs into the canonical cache.
- Future Salesforce mirror step: upsert Salesforce Quote/QuoteLineItem for `canonical_quotes`, and Salesforce Order/OrderItem for `canonical_orders`.
