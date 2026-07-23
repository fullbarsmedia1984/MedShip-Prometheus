// Central registry of Next.js data-cache tags and TTLs for the Zeus DAL.
//
// Every unstable_cache() wrapper in the app must take its tag from CACHE_TAGS
// and its revalidate window from CACHE_TTL, and every Inngest sync function
// that repopulates a domain's tables must call revalidateTag() for that
// domain's tag when it finishes. TTLs are a fallback matched to each sync's
// cron cadence (see the automations table in CLAUDE.md); tag invalidation from
// the crons is what keeps cached pages fresh within seconds of a sync.
export const CACHE_TAGS = {
  // Values for salesDashboard/incentives predate this module and are also
  // exported as SALES_DASHBOARD_CACHE_TAG (src/lib/data.ts) and
  // INCENTIVE_CACHE_TAG (src/lib/incentive/queries.ts) — keep them in sync.
  salesDashboard: 'sales-dashboard',
  incentives: 'incentive-dashboard',
  inventory: 'inventory-cache',
  orders: 'orders-cache',
  quotes: 'quotes-cache',
  catalog: 'catalog-cache',
  wallboard: 'wallboard-cache',
  kits: 'kits-cache',
  tam: 'tam-cache',
  integrations: 'integrations-cache',
  pricingReadiness: 'pricing-readiness-cache',
} as const

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS]

// Seconds. Chosen as ~1x–2x of each domain's sync cadence so a missed tag
// invalidation still self-heals within one cron cycle.
export const CACHE_TTL = {
  // P2 runs 8a/12p/4p Mon–Fri; an hour-level TTL is safe because P2 also
  // busts the tag on completion.
  inventory: 3600,
  // P7/P12 run every 15 min.
  salesOrders: 900,
  // P10 is a nightly delta ingest.
  catalog: 3600,
  // Wallboard is a kiosk that re-renders constantly; short TTL keeps it
  // snappy without hammering the DB between P7/P11 runs.
  wallboard: 300,
  kits: 900,
  // TAM datasets change only on manual loads.
  tam: 3600,
  // sync_events stream continuously; keep status views near-live.
  integrations: 60,
  pricingReadiness: 1800,
} as const
