import { unstable_cache } from 'next/cache'
import { CACHE_TAGS } from '@/lib/cache-tags'
import {
  getRevenueMetrics,
  getSalesDashboardCore,
  getMonthlyRevenue,
  getCategorySales,
  getRecentOrders,
  getInventoryAlerts,
  getIntegrationStatus,
  getSalesActivity,
  getPipelineSnapshot,
  getCustomersWithLocations,
  getRegionSummaries,
  getProfileCallMetrics,
} from '@/lib/data'
import type { ProfileCallMetricsResult, RevenueMetrics, SalesDashboardCore, SalesKpis, SalesLeaderboardWithHistory } from '@/lib/data'

const EMPTY_LEADERBOARD: SalesLeaderboardWithHistory = { current: [], history: [] }

const DEFAULT_METRICS: RevenueMetrics = {
  mtdRevenue: 0,
  mtdRevenueChange: 0,
  openOrders: 0,
  openOrdersChange: 0,
  fulfillmentRate: 0,
  fulfillmentRateChange: 0,
  avgShipDays: 0,
  avgShipDaysChange: 0,
}

const DEFAULT_SALES_KPIS: SalesKpis = {
  revenueMTD: 0,
  revenueQTD: 0,
  revenueYTD: 0,
  newBusinessRevenueMTD: 0,
  newBusinessRevenueQTD: 0,
  newBusinessRevenueYTD: 0,
  recurringBusinessRevenueMTD: 0,
  recurringBusinessRevenueQTD: 0,
  recurringBusinessRevenueYTD: 0,
  newBusinessOrdersMTD: 0,
  recurringBusinessOrdersMTD: 0,
  newBusinessMixMTD: 0,
  quotesSentMTD: 0,
  dealsClosedMTD: 0,
  avgDaysToClose: 0,
  pipelineValue: 0,
}

const DEFAULT_PROFILE_CALL_DATA: ProfileCallMetricsResult = {
  totalMTD: 0,
  totalLastMonth: 0,
  conversionRate: 0,
  connectRate: 0,
  avgDuration: 0,
  voicemailCount: 0,
  voicemailRate: 0,
  byRep: [],
}

async function safeLoad<T>(label: string, load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load()
  } catch (error) {
    console.error(`[dashboard-overview] ${label} failed`, error)
    return fallback
  }
}

/**
 * Builds the full dashboard-overview payload (KPIs, leaderboard, charts,
 * orders, alerts, integrations, map, calls) with per-section error tolerance,
 * cached for 5 minutes and busted by the sync crons via cache tags.
 *
 * Shared by the /api/dashboard/overview route (client refresh path) and the
 * /dashboard server page (server-rendered first paint). The payload is plain
 * JSON-serializable data, so it crosses the RSC boundary safely.
 */
export const getOverviewPayload = unstable_cache(
  async () => {
    const [
      metrics,
      salesCore,
      monthlyRevenue,
      categorySales,
      recentOrders,
      inventoryAlerts,
      integrations,
      activities,
      pipeline,
      mapCustomers,
      regionSummaries,
      profileCallData,
    ] = await Promise.all([
      safeLoad('revenue metrics', getRevenueMetrics, DEFAULT_METRICS),
      // Sales KPIs and the leaderboard both derive from the same ~13-month
      // fb_sales_orders core; load it once instead of once per section.
      safeLoad('sales dashboard core', getSalesDashboardCore, null as SalesDashboardCore | null),
      safeLoad('monthly revenue', getMonthlyRevenue, []),
      safeLoad('category sales', getCategorySales, []),
      safeLoad('recent orders', () => getRecentOrders(10), []),
      safeLoad('inventory alerts', () => getInventoryAlerts(5), []),
      safeLoad('integration status', getIntegrationStatus, []),
      safeLoad('sales activity', () => getSalesActivity(10), []),
      safeLoad('pipeline snapshot', getPipelineSnapshot, []),
      safeLoad('map customers', getCustomersWithLocations, []),
      safeLoad('region summaries', getRegionSummaries, []),
      safeLoad('profile call metrics', getProfileCallMetrics, DEFAULT_PROFILE_CALL_DATA),
    ])

    const salesKpis: SalesKpis = salesCore?.kpis ?? DEFAULT_SALES_KPIS
    const leaderboardData: SalesLeaderboardWithHistory = salesCore
      ? {
          current: [...salesCore.reps].sort((a, b) => b.revenueMTD - a.revenueMTD),
          history: salesCore.leaderboardHistory,
        }
      : EMPTY_LEADERBOARD

    return {
      metrics,
      salesKpis,
      monthlyRevenue,
      categorySales,
      recentOrders,
      inventoryAlerts,
      integrations,
      leaderboard: leaderboardData.current,
      leaderboardHistory: leaderboardData.history,
      activities,
      pipeline,
      mapCustomers,
      regionSummaries,
      profileCallData,
    }
  },
  ['dashboard-overview-payload'],
  { revalidate: 300, tags: [CACHE_TAGS.salesDashboard, CACHE_TAGS.integrations] }
)

export type OverviewPayload = Awaited<ReturnType<typeof getOverviewPayload>>
