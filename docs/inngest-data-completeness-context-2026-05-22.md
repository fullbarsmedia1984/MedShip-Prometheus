# Inngest And Data Completeness Context - 2026-05-22

This document is a focused handoff for a new ChatGPT 5.5 or Codex session. It summarizes the current Inngest state, the recent P7 Fishbowl Sales Order backfill stall, the fixes already pushed, and the data completeness goals for Zeus/Prometheus.

Prometheus, also called Zeus in client conversations, is Medical Shipment's internal integration and operations app. It joins Salesforce, Fishbowl, and later QuickBooks/EasyPost data into a Supabase-backed Next.js dashboard with Inngest orchestration.

## Current Production Baseline

- App: `https://medship-prometheus-production.up.railway.app`
- Branch: `master`
- Production host: Railway
- Orchestration: Inngest Cloud
- Database/cache: Supabase project `qknotdnyewlvtucuzklk`
- Fishbowl access: Cloudflare Access tunnel at `https://fishbowl.medshipment.com`
- Required Railway variable:

```text
FISHBOWL_API_URL=https://fishbowl.medshipment.com
```

Do not use an explicit Fishbowl origin port in production. The old direct-origin form is invalid behind Cloudflare Access:

```text
http://fishbowl.medshipment.com:2456
```

## Recent Commits Relevant To This Handoff

The following commits were pushed to `master` on May 22, 2026:

- `9413911` - `Unblock P7 Fishbowl backfill schedule`
  - Moved P7 scheduled cron off the same 15-minute boundary as P2 inventory.
  - Changed P7 incremental work to use one Fishbowl session for page fetch plus detail hydration.
  - Added migration `supabase/migrations/009_offset_fishbowl_sales_order_backfill.sql`.
- `c7c039d` - `Report P7 nested processed counts`
  - Fixed P7 schedule reporting so nested page/detail results count as processed rows in future runs.

Production Inngest was manually re-registered after push:

```powershell
curl.exe -sS -X PUT --fail-with-body https://medship-prometheus-production.up.railway.app/api/inngest
```

Result:

```json
{"message":"Successfully registered","modified":true}
```

## Key Inngest Automations

### P1: Salesforce Opportunity To Fishbowl SO

- Automation: `P1_OPP_TO_SO`
- Inngest function: `sf-opportunity-closed`
- Purpose: create or reconcile Fishbowl Sales Orders from Salesforce Opportunities.
- Current cron in DB: `*/15 * * * *`
- Current expected behavior: should usually process `0` records unless eligible Salesforce opportunities are found.
- Recent fix: Salesforce polling query was corrected away from unsupported SOQL `LAST_N_MINUTES`.

### P2: Fishbowl Inventory Sync

- Automation: `P2_INVENTORY_SYNC`
- Inngest function: `inventory-sync`
- Purpose: pull Fishbowl inventory to Supabase and mirror inventory quantities into Salesforce products.
- Current cron: `*/15 * * * *`
- Typical processed count: about `4,679` inventory rows.
- Uses the shared Fishbowl session lock.

### P7: Fishbowl Sales Orders Sync

- Automation: `P7_FB_SO_SYNC`
- Inngest function: `fishbowl-sales-orders-sync`
- Purpose: backfill and keep current Fishbowl Sales Order headers and details.
- Current cron in code and DB: `5,20,35,50 * * * *`
- This offset is intentional. P2 runs at minute `0,15,30,45`; P7 runs five minutes later to avoid lock collisions.
- Uses the shared Fishbowl session lock.

P7 manual event:

```text
fishbowl/sales-orders.sync
```

P7 worker events:

```text
fishbowl/sales-orders.backfill.pages
fishbowl/sales-orders.detail.hydrate
```

## Shared Fishbowl Session Lock

Fishbowl appears to have strict session/login limits. Zeus serializes Fishbowl automations with a database lock.

- Lock key: `app_settings.key = 'fishbowl_session_lock'`
- Default TTL: 15 minutes
- Code: `src/lib/fishbowl/session.ts`

When a job cannot acquire the lock, it logs a dismissed sync event rather than a hard failure:

```text
Fishbowl session lock is held until <timestamp>
```

This is expected occasionally. It is not expected every cycle.

## P7 Stall Diagnosis

The user reported the UI stuck at:

- Source pages: `646`
- Estimated headers: `64,600`
- Header coverage: `6.2%`
- Page coverage: `6.2%`
- Detail coverage: `25%`
- Cached lines: `9,692`
- Status: `running`
- Backfill message: `40 of 646 pages complete and 1,000 of 4,000 details hydrated`
- Last P7 run: `24 min ago`

Database triage showed P7 was not truly dead. It was being starved by Fishbowl session-lock collisions:

- P2 and P7 were both scheduled at `*/15 * * * *`.
- P2 often acquired the shared Fishbowl lock first.
- P7 then logged `dismissed` / `skipped` events.
- P7 did make progress when it won a lock window.

Example dismissed P7 event:

```text
Fishbowl session lock is held until 2026-05-22T20:45:00.221Z
```

## Fixes Already Applied

### 1. P7 Cron Offset

File:

```text
src/inngest/functions/fishbowl-sales-orders-sync.ts
```

P7 cron was changed from:

```text
*/15 * * * *
```

to:

```text
5,20,35,50 * * * *
```

Live Supabase `sync_schedules` was also updated:

```sql
update sync_schedules
set cron_expression = '5,20,35,50 * * * *'
where automation = 'P7_FB_SO_SYNC';
```

### 2. One Session Per P7 Incremental Chunk

Before the fix, P7 incremental mode acquired and released the Fishbowl session once for pages, then acquired and released again for details.

After the fix, scheduled incremental mode acquires one Fishbowl session and performs:

1. `processSalesOrderPageBatch`
2. `hydrateSalesOrderDetailBatch`

inside that same session.

This reduces login pressure and lock churn.

### 3. P7 Processed Count Reporting

P7 results are nested:

```json
{
  "pages": {
    "headersUpserted": 1000
  },
  "details": {
    "detailsSucceeded": 250
  }
}
```

The schedule row previously looked only at top-level fields, so `records_processed` stayed `0`. The reporting helper now counts nested page/detail results for future runs.

## Verified Post-Fix State

The first offset run after the fix succeeded.

Observed P7 success:

- Time: `2026-05-22 21:07:53 UTC`
- Status: `success`
- Duration: about `172,949 ms`
- Pages completed in that chunk: `10`
- Headers upserted in that chunk: `1,000`
- Details attempted: `250`
- Details succeeded: `250`
- Items upserted in that chunk: `1,814`
- Failed pages: `0`
- Failed details: `0`

Queue progress moved from:

```text
pages success: 40
details success: 1000
```

to:

```text
pages success: 50
details success: 1250
```

Remaining after the verified run:

```text
pages pending: 596
details pending: 3750
```

Note: pending detail count can increase as new pages are fetched because each page batch queues more detail hydration rows.

## Current Data Completeness Goals

### P7 Fishbowl Sales Orders

Primary objective: complete and auditable Fishbowl Sales Order coverage for Zeus Orders and Quotes.

Targets:

- `fb_sales_orders` contains every reachable Fishbowl Sales Order header.
- `fb_sales_order_items` contains detail line items for at least `99.5%` of non-void business Sales Orders.
- Business zero-line Sales Orders/Quotes below `0.5%`.
- Failed page checkpoints: `0`, or visible and retryable.
- Failed detail rows: `0`, or visible and retryable.
- P7 freshness under `30 minutes` after historical backfill completes.
- UI never implies totals are final until header and detail coverage pass target thresholds.

Known source baseline:

```text
Fishbowl source pages: 646
Expected page size: 100
Estimated headers: about 64,600
```

Current backfill behavior:

- Each successful P7 scheduled run processes `10` pages.
- Each successful P7 scheduled run hydrates `250` detail rows.
- Backfill should continue over many scheduled cycles unless batch sizes are temporarily increased.

### Salesforce Data Completeness

Goals:

- Salesforce full and incremental syncs remain healthy.
- Opportunity, product, account, user, and line item caches are fresh.
- Salesforce sync failures should fail loudly but should not hammer credentials.
- Salesforce auth must eventually migrate away from SOAP `login()` before the Salesforce Summer 2027 retirement deadline.

Watch tables:

```text
sf_users
sf_accounts
sf_products
sf_opportunities
sf_opportunity_line_items
sf_profile_calls
sf_sync_state
sync_schedules
sync_events
```

### Fishbowl Inventory Completeness

Goals:

- P2 stays fresh within 30 minutes.
- Inventory snapshot row counts remain near expected Fishbowl inventory count.
- Salesforce product inventory mirrors remain healthy.
- P2 should not starve P7 during historical backfill.

Typical P2 result:

```text
records_processed: about 4,679
duration: about 28-30 seconds
```

### Pricing Data Completeness

Goals:

- Contract pricing, COGS, and retail enforcement rules should be based on canonical product identity.
- Pricing page exists, but deeper data-quality and enforcement work remains a sprint item.
- Back-burner Hercules contract-pricing work exists as untracked local files at the time of this handoff:

```text
src/lib/hercules/
supabase/migrations/008_hercules_contract_pricing.sql
```

Do not assume those are committed.

## Operational Queries

### Sync Freshness

```sql
select
  automation,
  cron_expression,
  is_active,
  last_run_at,
  now() - last_run_at as last_run_age,
  last_run_status,
  last_run_duration_ms,
  records_processed
from sync_schedules
order by automation;
```

### P7 Queue Coverage

```sql
select 'pages' as queue, status, count(*)
from fishbowl_so_page_checkpoints
group by status
union all
select 'details' as queue, status, count(*)
from fishbowl_so_detail_queue
group by status
order by queue, status;
```

### Recent P7 Events

```sql
select
  created_at,
  status,
  error_message,
  payload,
  response
from sync_events
where automation = 'P7_FB_SO_SYNC'
order by created_at desc
limit 20;
```

### Recent P7 Runs

```sql
select
  mode,
  status,
  started_at,
  completed_at,
  pages_completed,
  headers_upserted,
  details_succeeded,
  items_upserted,
  error_message,
  raw_summary
from fishbowl_so_sync_runs
order by started_at desc
limit 20;
```

### Shared Fishbowl Lock

```sql
select key, value, updated_at
from app_settings
where key in ('fishbowl_session_lock', 'circuit_breaker:fishbowl')
order by key;
```

## Triage Playbook For The 5.5 Session

1. Confirm the latest production build includes commit `c7c039d` or newer.
2. Confirm `/api/inngest` registration shows `modified=false` after a stable deploy, or manually re-register once.
3. Watch the next P7 offset window at minute `5`, `20`, `35`, or `50`.
4. Query P7 queues before and after the run.
5. If pages/details increase, let backfill run.
6. If P7 logs `dismissed` repeatedly, inspect `fishbowl_session_lock` and determine which automation owns it.
7. If P2 is consistently blocking P7, consider a temporary backfill window:
   - Pause P2 for a defined period, or
   - Increase P7 cadence/batches carefully, or
   - Lower Fishbowl lock TTL only if all jobs reliably release the lock.
8. If P7 fails with auth or URL errors, inspect:
   - `FISHBOWL_API_URL`
   - Cloudflare Access service token variables
   - `circuit_breaker:fishbowl`
   - Fishbowl login limit messages
9. Do not delete Fishbowl or Salesforce records.
10. Treat test/warehouse/sample rows as flaggable, not deletable.

## Suggested Next Technical Moves

### Near Term

- Keep observing P7 over the next several offset cycles.
- Improve UI copy so `running` does not imply an active Inngest run when queues are merely pending.
- Add a visible "waiting for Fishbowl lock" state when the latest P7 event is `dismissed` due to lock.
- Add ETA based on remaining pages, remaining details, and observed per-run throughput.

### Backfill Acceleration Options

Conservative current pace:

```text
10 pages per successful run
250 details per successful run
4 scheduled runs per hour
```

This is safe but slow for roughly 646 pages and tens of thousands of details.

Possible acceleration, only after current stability is proven:

- Temporarily increase `FISHBOWL_SO_PAGE_BATCH` from `10` to `20`.
- Temporarily increase `FISHBOWL_SO_DETAIL_BATCH` from `250` to `500`.
- Temporarily pause P2 during a planned historical backfill window.
- Add a dedicated manual "backfill burst" action that runs one chunk at a time with lock awareness.

Avoid creating high-frequency Inngest loops that generate large execution counts or hammer Fishbowl login.

## Copy/Paste Kickoff Prompt For ChatGPT 5.5

Use this prompt to start the triage session:

```text
You are taking over Zeus/Prometheus Inngest data-completeness triage for Medical Shipment.

Read docs/inngest-data-completeness-context-2026-05-22.md first. Then inspect the current code and Supabase state. Our immediate goal is to ensure P7 Fishbowl Sales Order backfill continues making progress without starving or being starved by P2 inventory sync. Confirm latest production Inngest behavior, explain whether P7 is healthy, and recommend the next safe operational change only if needed.

Constraints:
- Do not delete Salesforce or Fishbowl records.
- Do not mutate Salesforce production unless explicitly requested.
- Preserve test/warehouse/sample Fishbowl rows for auditability; flag them instead of deleting.
- Favor truthful UI states over optimistic labels.
- Use Supabase queries and sync_events as durable evidence.
```

