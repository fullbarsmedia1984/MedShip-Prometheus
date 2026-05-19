# Data Completeness SOP

Date: May 19, 2026

## Purpose

This SOP defines how Zeus/Prometheus operators decide whether live Salesforce, Fishbowl, and pricing data is complete, fresh, and reconciled enough to trust for operational decisions.

Troubleshooting answers "what broke?" This SOP answers "is the data complete enough to use?"

## Scope

Covered systems:

- Salesforce: users, accounts, products, opportunities, opportunity line items, profile calls.
- Fishbowl: inventory, sales orders, sales order items.
- Zeus pricing: product identity, crosswalks, contracts, contract price lines, COGS, pricing rules, quality results.
- Supabase: canonical cache and monitoring tables.
- Inngest: schedule and run history.

Primary tables:

```text
sf_users
sf_accounts
sf_products
sf_opportunities
sf_opportunity_line_items
sf_profile_calls
inventory_snapshot
fb_sales_orders
fb_sales_order_items
opportunity_sales_order_links
pricing_products
product_crosswalk
customer_contracts
contract_price_lines
product_cogs
pricing_rules
pricing_quality_results
sync_schedules
sync_events
sf_sync_state
```

## Ownership

| Area | Primary Owner | Backup | Escalation |
| --- | --- | --- | --- |
| Salesforce cache | Salesforce/data owner | App owner | Salesforce admin |
| Fishbowl inventory | Operations/data owner | IT | Fishbowl admin |
| Fishbowl orders/quotes | Operations | App owner | Fishbowl admin |
| Pricing/contracts/COGS | Pricing/Purchasing | Finance | Data owner |
| Sync freshness | App owner | IT | Inngest/Railway owner |
| Dashboard API health | App owner | Engineering | Supabase/Railway owner |
| SOP maintenance | Data owner | App owner | Leadership review |

## Cadence

| Cadence | Checks |
| --- | --- |
| Every 15 minutes | Automated sync freshness, failed events, stale schedule alerts |
| Daily morning | Row counts, freshness, failed sync review, pricing blockers |
| Weekly | Sampling, reconciliation, unresolved exception review |
| Monthly | Full completeness report and threshold review |
| Before enforcement/cutover | Full runbook, sampling, reconciliation signoff |

## Sync Freshness

Run:

```sql
select
  automation,
  cron_expression,
  is_active,
  last_run_at,
  now() - last_run_at as last_run_age,
  next_run_at,
  last_run_status,
  last_run_duration_ms,
  records_processed
from sync_schedules
order by automation;
```

Expected freshness:

| Automation | Expected Freshness |
| --- | --- |
| `SF_INCREMENTAL_SYNC` | Last run within 30 minutes |
| `P2_INVENTORY_SYNC` | Last run within 30 minutes once re-enabled and healthy |
| `P7_FB_SO_SYNC` | Last run within 30 minutes once Fishbowl SO sync is enabled |
| `P9_PRICING_QUALITY_CHECK` | Last run within 26 hours once implemented |
| `SF_FULL_SYNC` | On demand; verify after manual run |

API checks:

```http
GET /api/sync/status
GET /api/sync/status?automation=SF_INCREMENTAL_SYNC
GET /api/sync/status?automation=P2_INVENTORY_SYNC
GET /api/sync/status?automation=P7_FB_SO_SYNC
```

Alert if:

- `lastRunStatus = failed`.
- `lastRunStatus = partial` for more than one cycle.
- No successful run inside the expected window.
- 24-hour success rate is below 95%.
- Failed events have exhausted retries.

## Salesforce Completeness

Run:

```sql
with actual as (
  select 'sf_users' table_name, count(*)::int actual_count, max(last_synced_at) max_last_synced_at from sf_users
  union all select 'sf_accounts', count(*)::int, max(last_synced_at) from sf_accounts
  union all select 'sf_products', count(*)::int, max(last_synced_at) from sf_products
  union all select 'sf_opportunities', count(*)::int, max(last_synced_at) from sf_opportunities
  union all select 'sf_opportunity_line_items', count(*)::int, max(last_synced_at) from sf_opportunity_line_items
  union all select 'sf_profile_calls', count(*)::int, max(last_synced_at) from sf_profile_calls
)
select
  a.table_name,
  a.actual_count,
  a.max_last_synced_at,
  now() - a.max_last_synced_at as cache_age,
  s.last_full_sync_at,
  s.last_incremental_sync_at,
  s.last_error
from actual a
left join sf_sync_state s using (table_name)
order by a.table_name;
```

Initial minimums:

| Table | Minimum Expected |
| --- | ---: |
| `sf_users` | 20-ish |
| `sf_accounts` | 2,000+ |
| `sf_products` | 765+ |
| `sf_opportunities` | 800+ |
| `sf_opportunity_line_items` | 285+ |
| `sf_profile_calls` | 0 allowed until source is confirmed |

Required field check:

```sql
select 'users_missing_name_or_email' check_name, count(*) from sf_users where name is null or email is null
union all select 'accounts_missing_name', count(*) from sf_accounts where name is null
union all select 'accounts_missing_owner', count(*) from sf_accounts where owner_sf_id is null
union all select 'products_missing_name_or_code', count(*) from sf_products where name is null or product_code is null
union all select 'opps_missing_core_fields', count(*) from sf_opportunities where name is null or stage_name is null or close_date is null or owner_sf_id is null
union all select 'won_opps_missing_amount', count(*) from sf_opportunities where is_won = true and amount is null
union all select 'line_items_missing_core_fields', count(*) from sf_opportunity_line_items where opportunity_sf_id is null or quantity is null or total_price is null
union all select 'profile_calls_missing_core_fields', count(*) from sf_profile_calls where activity_type is null or owner_sf_id is null or activity_date is null;
```

Thresholds:

- Blocker: required product/opportunity/order fields missing above 1%.
- Warning: owner/account relationship gaps above 2%.
- Info: profile calls empty until Salesforce confirms source availability.

## Fishbowl Inventory Completeness

Run:

```sql
select
  count(*) as inventory_rows,
  count(*) filter (where part_number is not null and part_number <> '') as rows_with_part_number,
  count(*) filter (where qty_available is not null) as rows_with_qty_available,
  count(*) filter (where sf_product_id is not null) as rows_with_sf_product_id,
  max(last_synced_at) as max_last_synced_at,
  now() - max(last_synced_at) as cache_age
from inventory_snapshot;
```

Thresholds:

- `inventory_rows > 0`.
- Current expected rough count: about 4,811 rows.
- Every row has `part_number` and `qty_available`.
- `cache_age < 30 minutes` during normal operating windows once P2 is healthy.
- `rows_with_sf_product_id` should increase as product crosswalk work matures.

Sanity check:

```sql
select
  count(*) filter (where qty_on_hand < 0) as negative_on_hand,
  count(*) filter (where qty_available < 0) as negative_available,
  count(*) filter (where qty_allocated < 0) as negative_allocated,
  count(*) filter (where qty_available > qty_on_hand) as available_gt_on_hand
from inventory_snapshot;
```

## Orders And Quotes Completeness

Fishbowl Sales Orders are the canonical operational source for quotes/orders.

Run:

```sql
select
  count(*) as total_sales_orders,
  count(*) filter (where canonical_state = 'quote') as quotes,
  count(*) filter (where canonical_state = 'order') as orders,
  count(*) filter (where canonical_state = 'void') as voids,
  max(last_synced_at) as max_last_synced_at,
  now() - max(last_synced_at) as cache_age
from fb_sales_orders;

select
  count(*) as total_lines,
  count(*) filter (where part_number is null) as lines_missing_part_number,
  count(*) filter (where quantity is null) as lines_missing_quantity,
  count(*) filter (where unit_price is null) as lines_missing_unit_price
from fb_sales_order_items;
```

Header/line reconciliation:

```sql
select
  h.so_number,
  h.status,
  h.canonical_state,
  h.total_amount,
  count(i.id) as line_count,
  sum(coalesce(i.total_price, 0)) as line_total
from fb_sales_orders h
left join fb_sales_order_items i on i.sales_order_number = h.so_number
group by h.so_number, h.status, h.canonical_state, h.total_amount
having count(i.id) = 0
   or abs(coalesce(h.subtotal_amount, h.total_amount, 0) - sum(coalesce(i.total_price, 0))) > 1.00
order by h.so_number;
```

Thresholds:

- Blocker: `fb_sales_orders` empty after P7 is enabled.
- Blocker: orders/quotes with zero lines above 0.5%.
- Warning: line total mismatch above $1 unless tax/shipping explains it.
- Warning: stale P7 sync over 30 minutes.

## Pricing Completeness

Primary API:

```http
GET /api/pricing/readiness
```

Core counts:

```sql
select 'pricing_products' table_name, count(*) from pricing_products
union all select 'product_crosswalk', count(*) from product_crosswalk
union all select 'customer_contracts', count(*) from customer_contracts
union all select 'contract_price_lines', count(*) from contract_price_lines
union all select 'product_cogs', count(*) from product_cogs
union all select 'pricing_rules', count(*) from pricing_rules
union all select 'pricing_quality_results', count(*) from pricing_quality_results;
```

Product identity:

```sql
select
  count(*) as pricing_products,
  count(*) filter (where is_active = true) as active_products,
  count(distinct pc.pricing_product_id) filter (where pc.match_status = 'matched') as matched_products
from pricing_products p
left join product_crosswalk pc on pc.pricing_product_id = p.id;
```

Contract and COGS coverage:

```sql
with active_products as (
  select id from pricing_products where is_active = true
),
active_contract_lines as (
  select distinct pricing_product_id
  from contract_price_lines
  where status = 'active'
    and effective_start <= current_date
    and (effective_end is null or effective_end >= current_date)
),
current_cogs as (
  select distinct pricing_product_id
  from product_cogs
  where is_current = true
    and effective_start <= current_date
    and (effective_end is null or effective_end >= current_date)
)
select
  (select count(*) from active_products) as active_products,
  (select count(*) from active_contract_lines) as products_with_active_contract_price,
  (select count(*) from current_cogs) as products_with_current_cogs;
```

Launch thresholds:

- 100% active contract lines resolve to canonical products.
- 95%+ active product contract-price coverage for pilot scope.
- 95%+ COGS coverage for margin enforcement scope.
- 0 unresolved blocker pricing quality results.
- 0 overlapping active contract lines for the same contract/product/UOM/tier/date.

## Cross-System Reconciliation

Salesforce ProductCode to Fishbowl part:

```sql
select
  count(*) as fishbowl_parts,
  count(*) filter (
    where exists (
      select 1
      from sf_products p
      where lower(trim(p.product_code)) = lower(trim(inventory_snapshot.part_number))
    )
  ) as direct_product_code_matches
from inventory_snapshot;
```

Opportunity line product completeness:

```sql
select
  count(*) as opportunity_lines,
  count(*) filter (where product_sf_id is not null) as lines_with_product_id,
  count(*) filter (where product_code is not null) as lines_with_product_code,
  count(*) filter (where unit_price is not null and total_price is not null) as lines_with_prices
from sf_opportunity_line_items;
```

## Sampling

Weekly sampling:

- 10 Salesforce accounts.
- 10 Salesforce opportunities.
- 10 Salesforce opportunity line items.
- 10 Fishbowl inventory parts.
- 10 Fishbowl sales orders.
- 10 contract price lines.
- 5 recent sync failures.

Sampling SQL:

```sql
select * from sf_opportunities order by random() limit 10;
select * from inventory_snapshot order by random() limit 10;
select * from fb_sales_orders order by random() limit 10;
select * from contract_price_lines order by random() limit 10;
```

## Alert Levels

| Level | Condition |
| --- | --- |
| Blocker | Core table unexpectedly empty |
| Blocker | Sync stale past 2 expected intervals |
| Blocker | Pricing readiness has blockers before enforcement |
| Warning | Success rate below 95% over 24h |
| Warning | Row count drops more than 10% day over day |
| Warning | Relationship gaps above threshold |
| Info | Expected empty table due to phase/not-yet-enabled source |

## Reporting Template

Each daily/weekly run should include:

- Run timestamp.
- Runner.
- Overall status: green/yellow/red.
- Failed checks.
- Tables below threshold.
- Stale syncs.
- New unresolved errors.
- Pricing blockers.
- Sampling exceptions.
- Owner assignments.
- Target resolution date.

## Future Automation

- Add `scripts/data-completeness-diagnostics.mjs`.
- Add `GET /api/dashboard/data-completeness`.
- Persist checks in `data_quality_runs` and `data_quality_results`.
- Surface a dashboard card beside integrations/pricing readiness.
- Add an Inngest daily data completeness job after the placeholder cron cleanup is complete.
