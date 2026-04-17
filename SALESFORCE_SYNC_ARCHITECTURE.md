# Salesforce Sync Architecture

**Last Updated:** 2026-04-17
**Status:** Live in Production

---

## Overview

MedShip Prometheus now syncs live data from Salesforce CRM into a Supabase PostgreSQL cache. The dashboard can toggle between **seed data** (for demos/development) and **live data** (production Salesforce) without code changes or restarts.

This document covers the architecture, data flow, and operational details of the sync system.

---

## Why Cache in Supabase?

Querying Salesforce directly from the dashboard is impractical:

| Concern | Direct SF Queries | Supabase Cache |
|---|---|---|
| API Limits | Enterprise: 1,000 calls/hr/user | Unlimited reads |
| Latency | 200-800ms per SOQL query | <50ms per Supabase query |
| Dashboard load | 10+ simultaneous queries = rate limit risk | All queries hit local Postgres |
| Derived metrics | Expensive aggregations on every page load | Computed once per sync |
| SF downtime | Dashboard goes blank | Dashboard keeps working with cached data |

---

## Architecture Diagram

```
  Salesforce CRM                    Supabase PostgreSQL
  ┌─────────────┐                   ┌──────────────────┐
  │  Users       │──┐               │  sf_users         │
  │  Accounts    │  │  Inngest      │  sf_accounts      │
  │  Products    │  ├──Function────>│  sf_products      │
  │  Opportunities│  │  (Full or    │  sf_opportunities  │
  │  Line Items  │  │  Incremental) │  sf_opp_line_items │
  │  Tasks/Events│──┘               │  sf_profile_calls  │
  └─────────────┘                   └────────┬─────────┘
                                             │
                                    ┌────────┴─────────┐
                                    │   Data Layer      │
                                    │  (src/lib/data.ts)│
                                    │                   │
                                    │  mode = 'seed'?   │
                                    │  → seed-data.ts   │
                                    │                   │
                                    │  mode = 'live'?   │
                                    │  → Supabase query │
                                    └────────┬─────────┘
                                             │
                                    ┌────────┴─────────┐
                                    │   Dashboard UI    │
                                    │  (Next.js pages)  │
                                    └──────────────────┘
```

---

## Database Schema

**Migration:** `supabase/migrations/002_sf_cache_tables.sql`

### Cache Tables (6)

| Table | SF Object | Records (first sync) | Key Fields |
|---|---|---|---|
| `sf_users` | User | 20 | sf_id, name, email, is_active, profile_name |
| `sf_accounts` | Account | 2,000+ | sf_id, name, billing/shipping address, owner_sf_id |
| `sf_products` | Product2 | 765+ | sf_id, product_code, name, qty_on_hand, qty_available |
| `sf_opportunities` | Opportunity | 800+ | sf_id, name, stage_name, amount, close_date, is_won |
| `sf_opportunity_line_items` | OpportunityLineItem | 285+ | sf_id, opportunity_sf_id, product_code, quantity, total_price |
| `sf_profile_calls` | Task + Event (union) | 0* | sf_id, activity_type, owner_sf_id, profile_call_outcome, ringdna_* |

*Profile Calls require the Profile Call record type to be created in Salesforce Setup first (see CLAUDE.md for field definitions).

### Support Tables (2)

| Table | Purpose |
|---|---|
| `app_settings` | Key-value store for data_source_mode ('seed' or 'live') and future feature flags |
| `sf_sync_state` | Per-table sync metadata: last sync time, record count, errors, duration |

All tables have RLS enabled and indexes on frequently queried columns (owner_sf_id, close_date, activity_date, etc.).

---

## Sync Functions

### Full Sync (`sf-full-sync`)

- **Trigger:** Manual via Inngest event `medship/sf.full-sync`
- **Initiated from:** Settings page "Sync Now" button or `POST /api/sync/salesforce`
- **Concurrency:** Limited to 1 (prevents parallel full syncs)
- **Execution order:** Users → Accounts → Products → Opportunities → Line Items → Profile Calls
- **Pagination:** Uses jsforce `autoFetch` with streaming to retrieve all records (up to 50k per object), bypassing the default 2,000 SOQL limit
- **Upsert strategy:** Batched upserts of 500 rows on `sf_id` unique constraint
- **Duration:** ~30-60 seconds depending on record volume

### Incremental Sync (`sf-incremental-sync`)

- **Trigger:** Cron every 15 minutes
- **Condition:** Only runs when data source mode is `'live'` — skips entirely in seed mode
- **Strategy:** Uses `last_sync_high_watermark` from `sf_sync_state` to query only records modified since the last sync (`WHERE LastModifiedDate >= :watermark`)
- **Tables synced:** Accounts, Opportunities, Profile Calls (the most frequently changing objects)

### Sync Helpers

**File:** `src/lib/salesforce/sync.ts`

Each object type has a dedicated sync function that:
1. Queries SF using `queryAll()` (streaming pagination)
2. Maps raw SF field names to Supabase column names
3. Upserts in batches via `upsertBatched()`
4. Updates `sf_sync_state` with record count, duration, and any errors

**Key implementation details:**
- Task and Event queries use different field sets — `Status` only exists on Task, not Event
- Profile Call fields include RingDNA metadata (direction, duration, connected, rating, keywords, recording URL) and Calendly metadata (no-show, rescheduled)
- The `queryAll()` helper uses jsforce's streaming API with `autoFetch: true` and `maxFetch: 50,000` to paginate past SF's default 2,000-record SOQL limit

---

## Data Source Toggle

### How It Works

1. **Setting stored in:** `app_settings` table, key `data_source_mode`, value `"seed"` or `"live"`
2. **Read by:** `getDataSourceMode()` in `src/lib/utils/app-settings.ts`
3. **Cached:** 30-second in-memory cache to avoid DB reads on every data layer call
4. **Toggled via:** `POST /api/settings/data-source` with `{ mode: 'seed' | 'live' }`

### Data Layer Routing

Every function in `src/lib/data.ts` checks the mode and routes accordingly:

```typescript
export async function getSalesLeaderboard() {
  const mode = await getDataSourceMode()
  if (mode === 'live') {
    const liveReps = await getLiveSalesReps()
    if (liveReps.length > 0) return liveReps
  }
  return seedData  // Fallback
}
```

### Graceful Fallback

If `mode === 'live'` but the cache tables are empty (no sync has run), the data layer falls back to seed data automatically and logs a warning. This prevents empty dashboards after toggling before syncing.

### Functions with Live Variants

| Function | Seed Source | Live Source |
|---|---|---|
| `getRevenueMetrics()` | seedMonthlyRevenue + seedOrders | sf_opportunities (is_won aggregation) |
| `getMonthlyRevenue()` | seedMonthlyRevenue | sf_opportunities bucketed by close_date month (12-month window) |
| `getSalesLeaderboard()` | seedEnhancedSalesReps | sf_users + sf_opportunities + sf_profile_calls |
| `getSalesKpis()` | seedEnhancedSalesReps aggregation | Live sales reps aggregation |
| `getPipelineSnapshot()` | seedPipelineStages | sf_opportunities grouped by stage_name |
| `getProfileCalls()` | seedProfileCalls | sf_profile_calls + sf_users + sf_accounts |
| `getProfileCallMetrics()` | seedProfileCalls aggregation | sf_profile_calls aggregation |
| `getCallOutcomeBreakdown()` | seedProfileCalls | sf_profile_calls.profile_call_outcome |
| `getTopCompetitorKeywords()` | seedProfileCalls.ringdnaKeywords | sf_profile_calls.ringdna_keywords |

Functions without live variants yet (will use seed data regardless of mode):
- `getOrders()` — sf_opportunities shape differs from Order type
- `getInventory()` — uses inventory_snapshot from P2, not sf_products
- `getCustomersWithLocations()` — needs geocoding (Phase 2)
- `getWeeklyCallVolume()` — needs weekly aggregation from sf_profile_calls

---

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/sync/salesforce` | Triggers full sync via Inngest event |
| GET | `/api/sync/salesforce` | Returns per-table sync state (record counts, timestamps, errors) |
| GET | `/api/settings/data-source` | Returns current mode (`seed` or `live`) |
| POST | `/api/settings/data-source` | Sets mode (`{ mode: 'seed' | 'live' }`) |

---

## Settings Page UI

The Settings page (`/dashboard/settings`) has a **Data Source** card at the top:

**Left panel — Mode Toggle:**
- Segmented control: Seed Data (amber) / Live Data (green)
- Inline confirmation when switching to live mode
- Warning if live mode is active but cache is empty

**Right panel — Sync Status:**
- Last full sync time (relative)
- Total records cached across all tables
- Per-table breakdown (collapsible): table name, record count, last sync, status icon
- "Sync Now" button — triggers full sync, polls every 3 seconds for progress
- Error warnings if any table had sync failures

---

## Inngest Configuration

**Functions registered in** `src/app/api/inngest/route.ts`:
- `sf-full-sync` — event-triggered, concurrency limit 1
- `sf-incremental-sync` — cron `*/15 * * * *`, skips in seed mode

**Environment variables required:**
- `INNGEST_EVENT_KEY` — from Inngest Cloud dashboard (Event Keys)
- `INNGEST_SIGNING_KEY` — from Inngest Cloud dashboard (Signing Key)

**Production:** Inngest Cloud (app.inngest.com) connected to Railway deployment
**Local dev:** Set `INNGEST_DEV=1` in `.env.local`, run `npx inngest-cli@latest dev`

---

## Salesforce Connection

**Auth method:** SOAP login (username + password + security token)
- OAuth2 Connected App is optional — if `SF_CLIENT_ID` and `SF_CLIENT_SECRET` are set with valid values (>10 chars, not placeholders), the OAuth2 flow is used instead
- Security token resets every time the password is changed
- Failed login attempts can trigger account lockout — unlock via SF Setup → Users

**Environment variables:**
```
SF_LOGIN_URL=https://login.salesforce.com
SF_USERNAME=dan@medicalshipment.com
SF_PASSWORD=<password>
SF_SECURITY_TOKEN=<token>
SF_CLIENT_ID=<optional>
SF_CLIENT_SECRET=<optional>
```

**Special characters in passwords:** Avoid `$` in passwords when setting via CLI — it gets interpreted as a shell variable. Set passwords with special characters via the Railway dashboard UI instead.

---

## Known Limitations

1. **Profile Calls:** Require the `Profile_Call` record type to be created on both Task and Event in Salesforce Setup before any data syncs. Currently 0 records.

2. **Geocoding:** Live SF accounts don't have lat/lng coordinates. The territory map will show seed data even in live mode until a geocoding step is added during sync (Phase 2).

3. **Sales rep colors:** Seed data has hardcoded colors per rep. Live `sf_users` generate deterministic colors from a hash of the `sf_id`. A rep_preferences table could be added for custom UI colors.

4. **Monthly revenue chart:** Uses seed data in both modes. Computing monthly aggregations from `sf_opportunities` requires either a Supabase RPC function or building the aggregation in TypeScript.

5. **Quotes:** Not tracked in the SF cache. The quote table on the Sales page shows seed data regardless of mode.

6. **RingDNA keywords:** Only populated if RingDNA is actively logging call keywords. Manual profile calls without RingDNA will have null keyword fields.

---

## Operational Runbook

### First-Time Setup
1. Run migration `002_sf_cache_tables.sql` in Supabase SQL Editor
2. Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` on Railway
3. Set `SF_USERNAME`, `SF_PASSWORD`, `SF_SECURITY_TOKEN` on Railway
4. Deploy to Railway
5. Go to Settings → click "Sync Now"
6. Verify record counts in the sync status panel
7. Toggle to "Live Data" when satisfied

### Triggering a Resync
- **UI:** Settings → Sync Now
- **API:** `POST https://medship-prometheus-production.up.railway.app/api/sync/salesforce`
- **Inngest:** Send event `medship/sf.full-sync` from Inngest dashboard

### Debugging Sync Failures
1. Check Inngest Cloud dashboard for function run errors
2. Check `sf_sync_state` table for `last_error` column
3. Check Railway logs: `railway logs --lines 50`
4. Check HTTP errors: `railway logs --http --status ">=400" --lines 20`
5. Common issues:
   - **INVALID_LOGIN:** Password changed, security token expired, or account locked
   - **INVALID_FIELD:** SF custom field doesn't exist yet (create in SF Setup)
   - **Round number record counts (2000, 800):** Pagination not working — should be fixed with `autoFetch`

### Monitoring
- **Incremental sync:** Runs every 15 minutes automatically (only in live mode)
- **Sync state:** `GET /api/sync/salesforce` returns per-table status
- **Inngest dashboard:** Shows all function runs, durations, and errors
