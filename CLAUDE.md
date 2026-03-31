# CLAUDE.md — MedShip Prometheus

## Project Overview
MedShip Prometheus is an integration hub for Medical Shipment LLC that automates data flow between Salesforce CRM, Fishbowl Inventory, and QuickBooks. It is NOT an ERP — it is a lightweight middleware app with a monitoring dashboard.

## Tech Stack
- **Framework**: Next.js 14+ (App Router, TypeScript strict)
- **Database**: Supabase (PostgreSQL)
- **Salesforce**: JSforce library
- **Fishbowl**: REST API (Bearer token auth)
- **Job Scheduling**: Inngest (event-driven + cron)
- **UI**: React + Tailwind CSS + shadcn/ui
- **Hosting**: Railway
- **Auth**: Supabase Auth

## Architecture Principles
1. **This app does not store business data** — it orchestrates API calls between SF, Fishbowl, and QB. The only local data is: sync logs, cached inventory snapshots, field mappings, and reorder rules.
2. **Idempotency is mandatory** — every sync operation must check for duplicates before executing. Use the `idempotency_key` column in `sync_events`.
3. **Fail gracefully** — if an external API is down, log the failure, queue for retry, and continue processing other records. Never let one bad record kill a batch.
4. **Log everything** — every API call to an external system gets a `sync_events` row. This is the audit trail.

## Key Patterns
- **API clients** (`src/lib/{system}/client.ts`): Handle auth, token refresh, base URL config. Singleton per request, not global.
- **Inngest functions** (`src/inngest/functions/`): One file per automation (P1-P6). Each is either event-triggered or cron-scheduled.
- **Structured logging**: Use `src/lib/utils/logger.ts` which writes to the `sync_events` Supabase table.
- **Retry logic**: Exponential backoff — 1 min, 5 min, 15 min, 1 hr. Max 4 retries. Implemented via `src/lib/utils/retry.ts`.

## Automations (Priority Order)
| ID | Name | Trigger | Systems |
|----|------|---------|---------|
| P1 | Opp Close → Fishbowl SO | SF poll every 2 min | SF → Fishbowl |
| P2 | Inventory Sync | Cron every 15 min | Fishbowl → SF |
| P3 | Invoice/Payment Sync | Cron every 1 hr | QB → SF |
| P4 | Shipment Tracking | Cron every 15 min | Fishbowl → SF |
| P5 | Quote PDF Generation | On-demand (API call) | SF → PDF → SF |
| P6 | Low Stock Alerts | After P2 runs | Fishbowl → Alert |

## Coding Standards
- All files TypeScript with strict mode
- Use `async/await`, never raw Promises
- All API responses typed — no `any` types in production code (acceptable in stubs)
- Error handling: try/catch at the Inngest function level, specific error types from API clients
- Environment variables: always accessed via a typed config object, never raw `process.env` in business logic
- Database queries: use Supabase client, never raw SQL in application code (SQL only in migration files)

## File Naming
- Components: PascalCase (`SyncStatusCard.tsx`)
- Utilities/libs: camelCase (`client.ts`, `queries.ts`)
- Types: camelCase file, PascalCase exports (`types.ts` → `export interface FishbowlSalesOrder`)
- Inngest functions: kebab-case (`sf-opportunity-closed.ts`)

## Commands
```bash
npm run dev          # Local development
npm run build        # Production build
npm run start        # Production server
npm run lint         # ESLint
npm run type-check   # TypeScript compiler check
```

## External API Notes

### Salesforce
- Using Username-Password OAuth flow (server-to-server, no user interaction)
- Custom fields on Opportunity: Fishbowl_SO_Number__c, Fulfillment_Status__c, Fulfillment_Error__c, Last_Sync_Attempt__c
- Custom fields on Product2: Qty_On_Hand__c, Qty_Available__c, Last_Inventory_Sync__c
- Bulk API for inventory updates (200 records per call max)

### Fishbowl Inventory
- REST API with Bearer token auth
- Login: POST /api/login → returns token
- Inventory: GET /api/parts/inventory (paginated, 100/page)
- Sales Orders: POST /api/sales-orders
- Part numbers must match SF Product2.ProductCode exactly

### QuickBooks
- TBD: Desktop (Web Connector) vs Online (REST API) — waiting on Dan's confirmation
- Phase 2 implementation

## UI Design Reference
The YashAdmin (Vite) template files are in `/design-reference/`. This is a purchased React dashboard template used as **visual design guidance only**.

**Rules:**
- Match YashAdmin's layout patterns, card styles, color palette, chart aesthetics, sidebar structure, and typography
- **DO NOT import or use react-bootstrap components** — rebuild everything in Tailwind CSS + shadcn/ui
- Study the template's JSX for structure and CSS for colors/spacing, then recreate with our stack
- Extract hex colors from the template's CSS variables into `tailwind.config.ts` under a `medship` namespace

**Design tokens to extract from YashAdmin:**
- Primary color (used for sidebar, buttons, active states)
- Success / Warning / Danger / Info colors
- Card border-radius, box-shadow values
- Sidebar width (expanded + collapsed)
- Header height
- Base font family and size scale
- Table row height and stripe color

## Dashboard Architecture
The dashboard serves two audiences in one UI:
1. **CEO (Dan Micic)**: Business metrics — revenue, orders, fulfillment rate, inventory health, sales activity
2. **Operations**: Integration health — sync status, event logs, failed syncs, connection configs

All pages initially render **seed data** from `src/lib/seed-data.ts`. The data access layer in `src/lib/data.ts` wraps all data fetching — every function will be swapped from seed data to Supabase queries as integrations go live.

## Chart Library
Use `recharts` for all charts. Do not introduce additional charting libraries.