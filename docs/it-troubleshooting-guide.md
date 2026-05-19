# Prometheus IT Troubleshooting Guide

Last updated: 2026-05-19

This guide is for diagnosing Prometheus connectivity and sync issues with Fishbowl, Cloudflare Access, Salesforce, Supabase, and Inngest.

Do not paste secrets into tickets or chat. When sharing results, redact tokens, passwords, cookie values, and authorization headers.

For completeness checks after connectivity is healthy, use [Data Completeness SOP](./data-completeness-sop.md). For the current restart plan, use [Zeus Next Start Plan](./zeus-next-start-plan.md).

## Quick Triage Matrix

| Symptom | Likely layer | First check |
| --- | --- | --- |
| `/api/health` fails | App/Railway | Deployment and app process |
| Fishbowl request returns Cloudflare 403 | Cloudflare Access | Access app and service-token policy |
| Fishbowl request redirects to `/cdn-cgi/access/login` | Cloudflare Access policy | Service Auth policy for service token |
| Fishbowl `/api/login` returns app approval message | Fishbowl admin | Approve integrated app in Fishbowl client |
| Fishbowl `/api/login` returns 401 credentials error | Fishbowl credentials | Username/password/MFA/user permissions |
| Fishbowl inventory probe returns 403 | Fishbowl permissions | User module rights |
| Salesforce cache stale | Inngest or Salesforce | `sf-incremental-sync` run history |
| Salesforce sync fails at connect step | Salesforce auth | Credentials, token, account lockout |
| Supabase data incomplete | Sync/query issue | Actual table counts and orphan checks |
| Dashboard shows seed-looking data | Data mode/table empty | `app_settings.data_source_mode`, live table row count |

## Fishbowl And Cloudflare Access

### Known Good Architecture

Prometheus reaches Fishbowl through:

`Prometheus -> Cloudflare Access service token -> Cloudflare Tunnel -> Fishbowl REST API`

The Cloudflare application is:

- Hostname: `fishbowl.medshipment.com`
- Type: Self-hosted Access application
- Required policy action: `Service Auth`
- Include selector: `Service Token = railway-fishbowl`
- No Require rules for the service-token policy
- No Exclude rules for the service-token policy

The Fishbowl integrated app is:

- App name: `MedShip Prometheus`
- App ID: `20260505`

### Expected Fishbowl REST Endpoints

Login:

```http
POST /api/login
Content-Type: application/json
CF-Access-Client-Id: <service-token-client-id>
CF-Access-Client-Secret: <service-token-client-secret>

{
  "appName": "MedShip Prometheus",
  "appDescription": "Medical Shipment internal Zeus integration",
  "appId": 20260505,
  "username": "<fishbowl-user>",
  "password": "<fishbowl-password>"
}
```

Expected success:

- HTTP `200 OK`
- JSON includes `token`
- JSON includes `user.serverVersion`

Inventory probe:

```http
GET /api/parts/inventory?pageNumber=1&pageSize=1
Authorization: Bearer <fishbowl-token>
CF-Access-Client-Id: <service-token-client-id>
CF-Access-Client-Secret: <service-token-client-secret>
```

Expected success:

- HTTP `200 OK`
- JSON inventory payload

### PowerShell Test Commands

Run from the repo root where `.env.local` exists.

Load local env vars into the PowerShell process:

```powershell
Get-Content .env.local | Where-Object { $_ -match '^\s*[^#][^=]*=' } | ForEach-Object {
  $parts = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1], 'Process')
}
```

DNS and TCP:

```powershell
$uri = [Uri]$env:FISHBOWL_API_URL
Resolve-DnsName $uri.Host
Test-NetConnection -ComputerName $uri.Host -Port 443 -InformationLevel Detailed
```

Expected:

- DNS returns Cloudflare A/AAAA records.
- `TcpTestSucceeded=True`.

No-token Access check:

```powershell
curl.exe -i --max-time 20 "$env:FISHBOWL_API_URL/api/login"
```

Expected:

- HTTP `403 Forbidden`
- Cloudflare Access headers

Service-token login check:

```powershell
$body = @{
  appName = 'MedShip Prometheus'
  appDescription = 'Medical Shipment internal Zeus integration'
  appId = 20260505
  username = $env:FISHBOWL_USERNAME
  password = $env:FISHBOWL_PASSWORD
} | ConvertTo-Json -Compress

Invoke-WebRequest `
  -Method POST `
  -Uri "$env:FISHBOWL_API_URL/api/login" `
  -Headers @{
    'CF-Access-Client-Id' = $env:FISHBOWL_CF_ACCESS_CLIENT_ID
    'CF-Access-Client-Secret' = $env:FISHBOWL_CF_ACCESS_CLIENT_SECRET
  } `
  -Body $body `
  -ContentType 'application/json' `
  -TimeoutSec 30
```

Expected:

- HTTP `200 OK`
- JSON contains a Fishbowl token.

### Fishbowl Failure Meanings

| Result | Meaning | Fix |
| --- | --- | --- |
| `403 Forbidden` from Cloudflare without token | Normal | No action |
| `302 Found` to `/cdn-cgi/access/login` with service token | Token detected but not authorized | Use `Service Auth` policy, include only service token |
| Metadata has `service_token_status=True` and `auth_status=NONE` | Token valid but no service-auth grant | Fix Access policy |
| `404 No endpoint POST /api/session` | Client is using old endpoint | Use `POST /api/login` |
| `400 Failed to read request` | Bad JSON/body shape | Use documented login payload |
| `401 new integrated application has been added` | App needs Fishbowl approval | Approve `MedShip Prometheus` in Fishbowl client |
| `401 invalid credentials` | Fishbowl auth issue | Check user/password/MFA/account state |
| Inventory probe `403` | Fishbowl user lacks permissions | Grant inventory/module rights |

## Salesforce Sync Troubleshooting

### Inngest Schedule Check

Open Inngest Cloud for the production app and inspect:

#### `sf-incremental-sync`

- Name: Salesforce Incremental Sync
- Trigger: cron `*/15 * * * *`
- Expected: one run about every 15 minutes

Interpretation:

- Success with `{ totalRecords: 0 }`: schedule is running and Salesforce had no changed rows.
- Success with `{ skipped: true, reason: "Data source mode is not live" }`: cron is running but live cache sync is disabled.
- Failure in `check-mode`: Supabase/settings issue.
- Failure in `connect-sf`: Salesforce auth/token/account lockout.
- Failure in `sync-incremental`: SOQL, missing field, Supabase upsert, or schema issue.
- No runs: Inngest app/cron/served endpoint is not active.

#### `sf-full-sync`

- Name: Salesforce Full Sync
- Trigger: event `medship/sf.full-sync`
- Expected: only runs when manually triggered.
- Do not treat lack of recurring full-sync runs as schedule failure.

Expected successful output includes counts for:

- `users`
- `accounts`
- `products`
- `opportunities`
- `lineItems`
- `profileCalls`
- `totalRecords`

#### `sf-opportunity-closed`

- Purpose: P1 closed-won opportunity -> Fishbowl sales order.
- Triggers:
  - Cron `*/2 * * * *`
  - Event `salesforce/opportunity.closed`

Expected:

- Success with `processed: 0` means no eligible opportunities.
- Failure at `connect-systems` can mean Salesforce or Fishbowl connection failure.
- SKU mismatch failures should go to manual review rather than infinite retry.

## Supabase SQL Checks

### Data Source Mode

```sql
select key, value, updated_at
from app_settings
where key = 'data_source_mode';
```

Expected:

- `value = "live"` for live cache/sync behavior.

### Salesforce Freshness

Do not rely on `sf_sync_state.record_count` as a table total. Use actual table counts.

```sql
with actual as (
  select 'sf_users' table_name, count(*)::int actual_count, max(last_synced_at) max_last_synced_at, null::timestamptz max_last_modified_date from sf_users
  union all select 'sf_accounts', count(*)::int, max(last_synced_at), max(last_modified_date) from sf_accounts
  union all select 'sf_products', count(*)::int, max(last_synced_at), null::timestamptz from sf_products
  union all select 'sf_opportunities', count(*)::int, max(last_synced_at), max(last_modified_date) from sf_opportunities
  union all select 'sf_opportunity_line_items', count(*)::int, max(last_synced_at), null::timestamptz from sf_opportunity_line_items
  union all select 'sf_profile_calls', count(*)::int, max(last_synced_at), max(last_modified_date) from sf_profile_calls
)
select
  a.table_name,
  a.actual_count,
  s.record_count as sf_sync_state_record_count_may_be_delta,
  a.max_last_synced_at,
  now() - a.max_last_synced_at as cache_write_age,
  a.max_last_modified_date,
  now() - a.max_last_modified_date as source_change_age,
  s.last_full_sync_at,
  s.last_incremental_sync_at,
  s.last_sync_high_watermark,
  s.last_sync_duration_ms,
  s.last_error
from actual a
left join sf_sync_state s using (table_name)
order by a.table_name;
```

Expected rough baselines:

- `sf_users`: about 20
- `sf_accounts`: 2,000+
- `sf_products`: 765+
- `sf_opportunities`: 800+
- `sf_opportunity_line_items`: 285+
- `sf_profile_calls`: may be 0 until Profile Call source data is confirmed

### Salesforce Errors

```sql
select *
from sf_sync_state
where last_error is not null;
```

Expected:

- No rows.

### Relationship Completeness

```sql
select 'opps_missing_account' check_name, count(*) from sf_opportunities o left join sf_accounts a on a.sf_id = o.account_sf_id where o.account_sf_id is not null and a.sf_id is null
union all select 'opps_missing_owner', count(*) from sf_opportunities o left join sf_users u on u.sf_id = o.owner_sf_id where o.owner_sf_id is not null and u.sf_id is null
union all select 'accounts_missing_owner', count(*) from sf_accounts a left join sf_users u on u.sf_id = a.owner_sf_id where a.owner_sf_id is not null and u.sf_id is null
union all select 'line_items_missing_opp', count(*) from sf_opportunity_line_items li left join sf_opportunities o on o.sf_id = li.opportunity_sf_id where o.sf_id is null
union all select 'line_items_missing_product', count(*) from sf_opportunity_line_items li left join sf_products p on p.sf_id = li.product_sf_id where li.product_sf_id is not null and p.sf_id is null
union all select 'calls_missing_owner', count(*) from sf_profile_calls c left join sf_users u on u.sf_id = c.owner_sf_id where c.owner_sf_id is not null and u.sf_id is null
union all select 'calls_missing_account', count(*) from sf_profile_calls c left join sf_accounts a on a.sf_id = c.account_sf_id where c.account_sf_id is not null and a.sf_id is null
union all select 'calls_missing_related_opp', count(*) from sf_profile_calls c left join sf_opportunities o on o.sf_id = c.related_opportunity_sf_id where c.related_opportunity_sf_id is not null and o.sf_id is null;
```

Expected:

- Zero or explainable small counts.
- Missing owners can happen when Salesforce owners are inactive or nonstandard users.

### Required Field Completeness

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

## P2 Inventory Sync Readiness

Before running P2:

- Fishbowl login returns `200 OK`.
- Fishbowl inventory probe returns `200 OK`.
- Salesforce connection health returns success.
- Supabase is reachable.
- `app_settings.data_source_mode = "live"`.
- Inngest function `inventory-sync` is registered.

After running P2:

```sql
select count(*) from inventory_snapshot;

select max(last_synced_at)
from inventory_snapshot;

select created_at, status, error_message, retry_count
from sync_events
where automation = 'P2_INVENTORY_SYNC'
order by created_at desc
limit 20;
```

Expected:

- `inventory_snapshot` row count becomes greater than 0.
- `max(last_synced_at)` is current.
- Latest P2 `sync_events` row is `success`.

## Escalation Notes

Escalate to Medical Shipment IT when:

- Cloudflare token is valid but Access still redirects to login.
- Cloudflare tunnel routes to the wrong origin or endpoint set.
- Fishbowl integrated app approval is needed.
- Fishbowl user lacks inventory, customer, or sales order permissions.
- Fishbowl server logs show REST API errors not visible from Prometheus.

Escalate to Salesforce admin when:

- Salesforce login/token fails.
- Required custom fields are missing.
- Profile Call records are expected but `sf_profile_calls` remains empty.
- Opportunity/Product/Line Item relationship completeness checks show large unexplained gaps.
