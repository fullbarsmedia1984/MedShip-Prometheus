# Prometheus Context Handoff - 2026-05-22

Prometheus, also called Zeus in client conversations, is Medical Shipment's internal integration and operations app. It joins Salesforce, Fishbowl, and later QuickBooks/EasyPost data into a Supabase-backed Next.js dashboard with Inngest orchestration.

This handoff captures the current state after the May 2026 P7 Fishbowl Sales Order completeness work and the Railway Fishbowl URL correction.

## Current Deployment State

- Branch: `master`
- Latest pushed commits before this handoff:
  - `88714d4 Route Fishbowl config failures through breaker`
  - `62f07e2 Install Inngest CLI`
  - `dec4353 Add Inngest trigger audit trail`
  - `e981166 Register Fishbowl completeness workers with Inngest`
  - `fda7722 Implement Fishbowl sales order completeness pipeline`
- User changed the Railway `FISHBOWL_API_URL` variable on 2026-05-22 and started a deploy.
- Required production Fishbowl URL:

```text
FISHBOWL_API_URL=https://fishbowl.medshipment.com
```

- Do not use the old direct-origin URL form:

```text
http://fishbowl.medshipment.com:2456
```

Cloudflare Access is enabled through service-token headers, so the explicit origin port must stay hidden behind the tunnel.

## Important Current Blocker

Before the Railway variable change finished deploying, P7 continued to see the old Fishbowl URL:

```json
{
  "protocol": "http",
  "host": "fishbowl.medshipment.com",
  "port": "2456",
  "hasExplicitPort": true,
  "cloudflareAccessEnabled": true
}
```

The Fishbowl circuit breaker is currently open in Supabase:

- Key: `circuit_breaker:fishbowl`
- Opened at: `2026-05-22T10:45:36.268Z`
- Expires at: `2026-05-22T14:45:36.268Z`
- Reason: invalid `FISHBOWL_API_URL` for Cloudflare Access.
- Failure count at last check: `16`

After the Railway deploy with the corrected URL is live, clear or expire this breaker before retrying P7. The fastest manual reset is to update `app_settings.value->isOpen` for `circuit_breaker:fishbowl` to `false`, or remove that key if the app tolerates missing breaker state.

## P7 Fishbowl Sales Order Completeness State

P7 is now reaching Inngest. The prior "button did nothing" issue was caused by stale Inngest Cloud registration. The production Inngest endpoint was manually synced with:

```bash
curl.exe -X PUT https://medship-prometheus-production.up.railway.app/api/inngest --fail-with-body
```

Inngest responded:

```json
{
  "message": "Successfully registered",
  "modified": true
}
```

This confirmed Inngest Cloud had stale function metadata before the sync.

## P7 Functions And Flow

The deployed `/api/inngest` endpoint reports:

- `function_count`: `17`
- `has_event_key`: `true`
- `has_signing_key`: `true`
- `mode`: `cloud`

Relevant P7 functions:

- `fishbowl-sales-orders-sync`
  - Cron: `*/15 * * * *`
  - Performs incremental behavior.
- `fishbowl-sales-orders-sync-manual`
  - Event: `fishbowl/sales-orders.sync`
  - Used by Zeus Integrations "Run Now" and "Start/Resume Backfill" controls.
- `fishbowl-sales-orders-backfill-pages`
  - Event: `fishbowl/sales-orders.backfill.pages`
- `fishbowl-sales-orders-detail-hydrate`
  - Event: `fishbowl/sales-orders.detail.hydrate`

Manual trigger auditing was added in `POST /api/sync/trigger`. A Start/Resume Backfill click now creates a `sync_events` breadcrumb before sending to Inngest. That row has:

- `source_system = prometheus`
- `target_system = inngest`
- `status = pending`
- `payload.eventName = fishbowl/sales-orders.sync`
- `response.eventId = <Inngest event id>`

The actual worker writes separate P7 success/failure rows.

## Latest Live Data Snapshot

Snapshot taken on 2026-05-22 during this handoff:

| Table | Rows |
| --- | ---: |
| `fb_sales_orders` | 116 |
| `fb_sales_order_items` | 638 |
| `fishbowl_so_sync_runs` | 0 |
| `fishbowl_so_page_checkpoints` | 0 |
| `fishbowl_so_detail_queue` | 0 |

Sync schedule snapshot:

| Automation | Last Status | Last Run | Records |
| --- | --- | --- | ---: |
| `P2_INVENTORY_SYNC` | `partial` | `2026-05-05 17:38:31.481+00` | 4808 |
| `P7_FB_SO_SYNC` | `failed` | `2026-05-22 14:16:36.415+00` | 0 |

P7 has not started a true backfill yet. No P7 checkpoint rows exist.

## What Was Built For P7

Schema/migration:

- `supabase/migrations/007_fishbowl_so_completeness.sql`

New/updated data model:

- `fishbowl_so_sync_runs`
- `fishbowl_so_page_checkpoints`
- `fishbowl_so_detail_queue`
- Additional tracking columns on `fb_sales_orders`

Core helper files:

- `src/lib/fishbowl/sales-order-completeness.ts`
- `src/lib/fishbowl/sales-order-quality.ts`
- `src/lib/fishbowl/sales-order-cache.ts`
- `src/lib/fishbowl/sales-orders.ts`

Inngest wiring:

- `src/inngest/functions/fishbowl-sales-orders-sync.ts`
- `src/inngest/client.ts`
- `src/inngest/index.ts`
- `src/app/api/inngest/route.ts`

UI/API visibility:

- `src/app/api/dashboard/integrations/route.ts`
- `src/app/dashboard/integrations/page.tsx`
- `src/app/api/dashboard/orders/route.ts`
- `src/app/api/dashboard/quotes/route.ts`

## Immediate Next Steps

1. Wait for the Railway deploy that includes the corrected `FISHBOWL_API_URL`.
2. Confirm production sees the corrected Fishbowl profile.
   - Best path: use Zeus Fishbowl health/settings UI if available.
   - DB symptom should no longer show `protocol=http`, `port=2456` in new P7 sync events.
3. Clear the Fishbowl circuit breaker if it is still open after deploy.
4. Click Integrations -> P7 -> Start/Resume Backfill.
5. Verify the following tables:

```sql
select count(*) from fishbowl_so_sync_runs;
select count(*) from fishbowl_so_page_checkpoints;
select count(*) from fishbowl_so_detail_queue;
```

Expected first successful P7 Start/Resume result:

- `fishbowl_so_sync_runs` gets a `backfill` run.
- `fishbowl_so_page_checkpoints` gets approximately `646` checkpoint rows.
- `fishbowl_so_detail_queue` remains empty until page batches fetch headers.

6. Then run/follow page and detail workers:
   - Fetch Pages / `backfill.pages`
   - Hydrate Details / `detail.hydrate`
   - Scheduled incremental should continue every 15 minutes.

## Data Completeness Goal

The current Orders and Quotes views are truthful but incomplete. They are based on the current Fishbowl SO cache:

- `116` cached headers
- `638` cached line items
- No historical completeness checkpoints yet

P7 success criteria:

- All reachable Fishbowl Sales Order headers cached.
- Detail line items hydrated for at least `99.5%` of non-void business sales orders.
- Business zero-line rows below `0.5%`.
- Freshness under `30 minutes` after historical backfill completes.
- UI shows coverage, failures, and last sync clearly.

## Inngest Notes

- Inngest was upgraded from the free execution cap issue.
- The local repo now has `inngest-cli@1.21.0` installed as a dev dependency.
- The CLI is useful for local development but does not expose hosted Cloud run inspection commands in this version.
- Hosted run state still needs Inngest Dashboard or durable Zeus/Supabase breadcrumbs.
- After function changes, production Inngest Cloud may need manual sync:

```bash
curl.exe -X PUT https://medship-prometheus-production.up.railway.app/api/inngest --fail-with-body
```

## Related Docs

- [Prometheus Context](./prometheus-context.md)
- [IT Troubleshooting Guide](./it-troubleshooting-guide.md)
- [Data Completeness SOP](./data-completeness-sop.md)
- [Zeus Next Start Plan](./zeus-next-start-plan.md)
- [P7 implementation plan embedded in session history; consolidate later if needed](./data-completeness-sop.md)
