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
  getSalesLeaderboard,
  getSalesActivity,
  getPipelineSnapshot,
  getCustomersWithLocations,
  getRegionSummaries,
  getProfileCallMetrics,
} from '@/lib/data'

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
      leaderboard,
      activities,
      pipeline,
      mapCustomers,
      regionSummaries,
      profileCallData,
    ] = await Promise.all([
      getRevenueMetrics(),
      getSalesKpis(),
      getMonthlyRevenue(),
      getCategorySales(),
      getRecentOrders(10),
      getInventoryAlerts(5),
      getIntegrationStatus(),
      getSalesLeaderboard(),
      getSalesActivity(10),
      getPipelineSnapshot(),
      getCustomersWithLocations(),
      getRegionSummaries(),
      getProfileCallMetrics(),
    ])

    return NextResponse.json({
      metrics,
      salesKpis,
      monthlyRevenue,
      categorySales,
      recentOrders,
      inventoryAlerts,
      integrations,
      leaderboard,
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
