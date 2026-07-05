import { NextResponse } from 'next/server'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import {
  getRevenueMetrics,
  getSalesKpis,
  getMonthlyRevenue,
  getCategorySales,
  getRecentOrders,
  getInventoryAlerts,
  getIntegrationStatus,
  getSalesLeaderboardWithHistory,
  getSalesActivity,
  getPipelineSnapshot,
  getCustomersWithLocations,
  getRegionSummaries,
  getProfileCallMetrics,
} from '@/lib/data'
import type { ProfileCallMetricsResult, RevenueMetrics, SalesKpis, SalesLeaderboardWithHistory } from '@/lib/data'

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

export async function GET() {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const [
      metrics,
      salesKpis,
      monthlyRevenue,
      categorySales,
      recentOrders,
      inventoryAlerts,
      integrations,
      leaderboardData,
      activities,
      pipeline,
      mapCustomers,
      regionSummaries,
      profileCallData,
    ] = await Promise.all([
      safeLoad('revenue metrics', getRevenueMetrics, DEFAULT_METRICS),
      safeLoad('sales kpis', getSalesKpis, DEFAULT_SALES_KPIS),
      safeLoad('monthly revenue', getMonthlyRevenue, []),
      safeLoad('category sales', getCategorySales, []),
      safeLoad('recent orders', () => getRecentOrders(10), []),
      safeLoad('inventory alerts', () => getInventoryAlerts(5), []),
      safeLoad('integration status', getIntegrationStatus, []),
      safeLoad('sales leaderboard', getSalesLeaderboardWithHistory, EMPTY_LEADERBOARD),
      safeLoad('sales activity', () => getSalesActivity(10), []),
      safeLoad('pipeline snapshot', getPipelineSnapshot, []),
      safeLoad('map customers', getCustomersWithLocations, []),
      safeLoad('region summaries', getRegionSummaries, []),
      safeLoad('profile call metrics', getProfileCallMetrics, DEFAULT_PROFILE_CALL_DATA),
    ])

    return NextResponse.json({
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
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
