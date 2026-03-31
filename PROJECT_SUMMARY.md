# MedShip Prometheus — Project Summary

**Generated:** 2026-03-31
**Purpose:** Client-facing summary of everything built to date.

---

## What Is This?

MedShip Prometheus is an integration hub for Medical Shipment LLC that automates data flow between **Salesforce CRM**, **Fishbowl Inventory**, and **QuickBooks**. It includes a full monitoring dashboard for both executive visibility and operations management.

It is **not** an ERP. It is lightweight middleware with a web-based dashboard, hosted on Railway.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, TypeScript strict) |
| Database | Supabase (PostgreSQL with Row-Level Security) |
| Salesforce | JSforce (Username-Password OAuth) |
| Fishbowl | REST API (Bearer token auth) |
| QuickBooks | REST API (OAuth2) — Phase 2 |
| Job Scheduling | Inngest (event-driven + cron) |
| Shipping | EasyPost SDK |
| PDF Generation | @react-pdf/renderer |
| UI | React 19 + Tailwind CSS 4 + shadcn/ui |
| Charts | Recharts |
| Auth | Supabase Auth |
| Hosting | Railway |

---

## Automation Phases — Implementation Status

### P1: Opportunity Close to Fishbowl Sales Order — FULLY IMPLEMENTED

- **Trigger:** Polls Salesforce every 2 minutes + Salesforce Platform Event webhook
- **Flow:** When a Salesforce Opportunity is marked "Closed Won":
  1. Validates all product SKUs exist in Fishbowl
  2. Auto-creates the Fishbowl customer if they don't exist
  3. Creates a Sales Order in Fishbowl with all line items
  4. Writes the SO number back to Salesforce (`Fishbowl_SO_Number__c`)
  5. Updates fulfillment status fields on the Opportunity
- **Idempotency:** Uses the SF Opportunity ID as a key — will never create duplicate SOs
- **Error Handling:** Failures are logged, queued for retry (exponential backoff: 1m, 5m, 15m, 1hr), and the Opportunity is marked with the error message

### P2: Inventory Sync — FULLY IMPLEMENTED

- **Trigger:** Cron every 15 minutes
- **Flow:**
  1. Fetches all inventory from Fishbowl (paginated, 100 items/page)
  2. Upserts data into a local `inventory_snapshot` table for fast lookups
  3. Bulk updates Salesforce Product2 records with `Qty_On_Hand__c` and `Qty_Available__c` (200 records/batch to stay within Salesforce limits)
  4. Triggers P6 (low stock check) after completion
- **Manual trigger available** via API

### P3: QuickBooks Invoice/Payment Sync — STUB ONLY

- **Trigger:** Cron every hour (scheduled)
- **Status:** Scaffold in place. Awaiting confirmation on QB Desktop vs QB Online.
- **Planned flow:** Sync invoices and payments from QuickBooks into Salesforce

### P4: Shipment Tracking — STUB ONLY

- **Trigger:** Cron every 15 minutes (scheduled)
- **Status:** Scaffold in place. EasyPost SDK integrated but webhook handler not wired up.
- **Planned flow:** Pull shipment/tracking data from Fishbowl, update SF tracking fields

### P5: Quote PDF Generation — STUB ONLY

- **Trigger:** On-demand (API call)
- **Status:** Scaffold in place. @react-pdf/renderer is installed.
- **Planned flow:** Generate branded PDF quotes with real-time inventory availability, attach to SF

### P6: Low Stock Alerts — STUB ONLY

- **Trigger:** After P2 completes + cron every 15 minutes
- **Status:** Scaffold in place.
- **Planned flow:** Compare inventory levels against per-product reorder rules, generate alerts

### Retry Handler — PARTIALLY IMPLEMENTED

- **Trigger:** Cron every minute
- **Status:** P1 retry fully working. P2 retries are dismissed (all-or-nothing sync). P3-P6 not yet implemented.
- **Schedule:** 1 minute → 5 minutes → 15 minutes → 1 hour (max 4 retries)

---

## Database Schema (Supabase PostgreSQL)

Six tables, all with Row-Level Security enabled:

| Table | Purpose |
|-------|---------|
| `sync_events` | Audit log of every automation run — status, errors, retries, request/response payloads, idempotency keys |
| `inventory_snapshot` | Cached Fishbowl inventory for fast lookups and SF bulk updates |
| `field_mappings` | Configurable Salesforce-to-Fishbowl field translations with transform functions |
| `reorder_rules` | Per-product stock thresholds for low-stock alerts |
| `connection_configs` | API credentials for external systems (encrypted at rest) |
| `sync_schedules` | Cron schedules + last run stats for each automation |

Migration file: `supabase/migrations/001_initial_schema.sql`

---

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Connection status for all systems (Supabase, Salesforce, Fishbowl, QuickBooks) |
| GET | `/api/sync/status` | Automation stats + recent events with 24h success rates |
| POST | `/api/sync/trigger` | Manually trigger any automation |
| GET | `/api/inventory` | Query inventory snapshot (by part number, search term, or paginated list) |
| POST | `/api/inngest` | Inngest framework handler for all scheduled/event-driven functions |
| POST | `/api/webhooks/salesforce` | Receives Salesforce Platform Events, triggers P1 |
| POST | `/api/webhooks/easypost` | Receives EasyPost tracking updates (handler not yet implemented) |

---

## Dashboard — FULLY BUILT

The dashboard is complete with all pages rendering **seed data**. The data access layer (`src/lib/data.ts`) wraps all data fetching — every function is designed to be swapped from seed data to live Supabase queries as integrations go live.

### Pages

| Route | Page | Audience | What It Shows |
|-------|------|----------|---------------|
| `/dashboard` | Home | CEO + Ops | KPI cards (revenue, orders, fulfillment rate, inventory health), revenue chart, sync status cards, integration health |
| `/dashboard/sales` | Sales | CEO | Sales rep leaderboard, pipeline breakdown by stage, revenue by rep chart, recent sales activity feed |
| `/dashboard/orders` | Orders | CEO + Ops | Filterable order table with status, customer, dates, fulfillment status |
| `/dashboard/inventory` | Inventory | CEO + Ops | Product inventory table with stock levels, categories, last sync times |
| `/dashboard/integrations` | Integrations | Ops | Per-system integration cards with connection status, run history, manual trigger controls |
| `/dashboard/events` | Events | Ops | Sync event log table with drill-down to individual event details |
| `/dashboard/failed` | Failed Syncs | Ops | Failed syncs ready for retry, with error details and retry controls |
| `/dashboard/mappings` | Mappings | Ops | Field mapping configuration between Salesforce and Fishbowl |
| `/dashboard/settings` | Settings | Ops | App configuration settings |

### UI Components Built

**Layout:**
- Collapsible sidebar with main/operations/configuration sections
- Header with page title and breadcrumb navigation

**Dashboard Components:**
- KPI cards with icons and trend indicators
- Sync status mini-cards per automation
- Status badges (healthy, error, pending, warning, etc.)
- Sparkline charts (7-day trends)
- Data tables (generic, reusable)
- Event log table with filtering
- Sales leaderboard
- Sales activity feed
- Pipeline snapshot
- Failed sync rows with retry actions
- Empty states, refresh indicators, connection indicators

**Charts (Recharts):**
- Monthly revenue line chart
- Product category pie chart
- Revenue by sales rep bar chart
- Pipeline by rep bar chart
- Sync success/failure rate chart

### Design System

| Token | Value |
|-------|-------|
| Primary | `#452B90` (Deep Purple) |
| Secondary | `#F8B940` (Golden) |
| Success | `#3A9B94` (Teal) |
| Info | `#58BAD7` (Sky Blue) |
| Warning | `#FF9F00` (Orange) |
| Danger | `#FF5E5E` (Red) |
| Body Background | `#F3F0EC` (Light Beige) |
| Sidebar | `#222B40` (Dark Navy) |
| Font | Poppins (300-700 weights) |

---

## External System Clients

### Salesforce (`src/lib/salesforce/`)

Fully implemented with:
- OAuth2 connection via jsforce (username-password flow)
- Auto-reconnect on `INVALID_SESSION`
- SOQL queries for unsynced opportunities, product lookups
- Mutations for fulfillment status updates, bulk Product2 inventory updates

**Custom fields required on Salesforce:**

On Opportunity:
- `Fishbowl_SO_Number__c` (Text)
- `Fulfillment_Status__c` (Picklist/Text)
- `Fulfillment_Error__c` (Long Text Area)
- `Last_Sync_Attempt__c` (DateTime)

On Product2:
- `Qty_On_Hand__c` (Number)
- `Qty_Available__c` (Number)
- `Last_Inventory_Sync__c` (DateTime)

### Fishbowl Inventory (`src/lib/fishbowl/`)

Fully implemented with:
- REST API client with bearer token auth, auto-retry on 401, 30s timeout
- Paginated inventory fetch (100 items/page)
- Single part lookup and validation
- Sales order creation
- Customer lookup and auto-creation
- Custom error classes (`FishbowlApiError`, `FishbowlPartNotFoundError`, `FishbowlCustomerNotFoundError`)

### QuickBooks (`src/lib/quickbooks/`)

Skeleton only:
- OAuth2 token refresh logic stubbed
- REST API request wrapper stubbed
- Supports sandbox and production modes
- Awaiting decision on Desktop (Web Connector) vs Online (REST API)

### EasyPost (`src/lib/easypost/`)

SDK wrapper built:
- Shipment creation, rate purchasing, tracking
- Webhook receiver endpoint exists but not wired to business logic

---

## Infrastructure & Utilities

### Logging (`src/lib/utils/logger.ts`)
- Every API call to an external system creates a `sync_events` row
- Functions: `logSyncEvent`, `updateSyncEvent`, `hasSuccessfulSync` (idempotency), `getRetryableEvents`
- Structured console logging in JSON format

### Retry Logic (`src/lib/utils/retry.ts`)
- Exponential backoff with jitter for API calls
- Fixed retry schedule for sync events: 1min → 5min → 15min → 1hr (max 4 retries)
- Identifies retryable errors (network failures, rate limits, 5xx responses)

### Seed Data (`src/lib/seed-data.ts`)
- Deterministic seeded PRNG for reproducible demo data
- 50+ medical/simulation products across 6 categories
- Customers, orders, sales reps, monthly revenue trends
- Integration status snapshots and field mapping configs

---

## Environment Variables Required

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

# Salesforce
SF_LOGIN_URL
SF_CLIENT_ID (optional)
SF_CLIENT_SECRET (optional)
SF_USERNAME
SF_PASSWORD
SF_SECURITY_TOKEN

# Fishbowl
FISHBOWL_API_URL
FISHBOWL_USERNAME
FISHBOWL_PASSWORD

# QuickBooks (Phase 2)
QB_ENVIRONMENT
QB_CLIENT_ID
QB_CLIENT_SECRET
QB_REALM_ID

# EasyPost (Phase 2)
EASYPOST_API_KEY

# Inngest
INNGEST_EVENT_KEY
INNGEST_SIGNING_KEY

# App
NEXT_PUBLIC_APP_URL
NODE_ENV
```

---

## File Structure

```
src/
├── app/
│   ├── api/
│   │   ├── inngest/route.ts          # Inngest handler
│   │   ├── health/route.ts           # Health check
│   │   ├── sync/status/route.ts      # Sync status
│   │   ├── sync/trigger/route.ts     # Manual trigger
│   │   ├── inventory/route.ts        # Inventory lookup
│   │   └── webhooks/
│   │       ├── salesforce/route.ts    # SF Platform Events
│   │       └── easypost/route.ts     # EasyPost tracking
│   ├── dashboard/
│   │   ├── layout.tsx                # Sidebar + content
│   │   ├── page.tsx                  # Main dashboard
│   │   ├── sales/page.tsx
│   │   ├── orders/page.tsx
│   │   ├── inventory/page.tsx
│   │   ├── integrations/page.tsx
│   │   ├── events/page.tsx
│   │   ├── failed/page.tsx
│   │   ├── mappings/page.tsx
│   │   └── settings/page.tsx
│   ├── layout.tsx                    # Root layout
│   ├── page.tsx                      # Home (redirect)
│   ├── login/page.tsx
│   └── globals.css                   # Design tokens
├── components/
│   ├── layout/                       # Header, Sidebar
│   ├── dashboard/                    # KPI cards, tables, feeds
│   ├── charts/                       # Recharts components
│   ├── ui/                           # shadcn/ui base components
│   └── providers.tsx                 # Theme + Supabase context
├── inngest/
│   ├── client.ts                     # Inngest instance + events
│   ├── index.ts                      # Export all functions
│   └── functions/
│       ├── sf-opportunity-closed.ts  # P1 - FULL
│       ├── inventory-sync.ts         # P2 - FULL
│       ├── qb-invoice-sync.ts        # P3 - STUB
│       ├── shipment-tracking-sync.ts # P4 - STUB
│       ├── quote-pdf-generate.ts     # P5 - STUB
│       ├── low-stock-check.ts        # P6 - STUB
│       └── retry-failed-syncs.ts     # PARTIAL
├── lib/
│   ├── salesforce/                   # SF client, queries, mutations
│   ├── fishbowl/                     # FB client, inventory, sales orders
│   ├── quickbooks/                   # QB client (skeleton)
│   ├── easypost/                     # EasyPost client
│   ├── supabase/                     # Admin, server, browser clients
│   ├── utils/                        # Logger, retry, mapping
│   ├── data.ts                       # Data access layer (seed → Supabase)
│   └── seed-data.ts                  # Demo data
└── types/
    └── index.ts                      # All shared TypeScript types

supabase/
└── migrations/
    └── 001_initial_schema.sql        # Full schema with RLS
```

---

## Summary Table

| Area | Status |
|------|--------|
| P1: Opp → Fishbowl SO | Fully implemented |
| P2: Inventory Sync | Fully implemented |
| P3: QB Invoice Sync | Stub only |
| P4: Shipment Tracking | Stub only |
| P5: Quote PDF | Stub only |
| P6: Low Stock Alerts | Stub only |
| Retry Handler | P1 complete, P2+ pending |
| Salesforce Client | Fully implemented |
| Fishbowl Client | Fully implemented |
| QuickBooks Client | Skeleton |
| EasyPost Client | SDK wrapper built |
| Database Schema | Complete (6 tables + RLS) |
| API Endpoints | 7 endpoints, all functional |
| Dashboard UI | 10 pages, fully built with seed data |
| Charts | 5 chart components |
| Auth | Supabase Auth scaffolded |
| Deployment | Railway configured |
