import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { requireApiAuth } from '@/lib/auth'
import {
  SALES_DASHBOARD_CACHE_TAG,
  getSalesDashboardCore,
  getPipelineByRep,
  getQuotes,
  getProfileCalls,
  getProfileCallMetrics,
  getWeeklyCallVolume,
  getCallOutcomeBreakdown,
  getCallActivitySummary,
} from '@/lib/data'
import { getCohortDashboard } from '@/lib/cohorts'

const getSalesDashboardPayload = unstable_cache(
  async () => {
    const [
      salesCore,
      pipelineByRep,
      quotes,
      profileCalls,
      weeklyVolume,
      outcomeBreakdown,
      profileMetrics,
      callActivitySummary,
      cohorts,
    ] = await Promise.all([
      getSalesDashboardCore(),
      getPipelineByRep(),
      getQuotes({ pageSize: 40 }),
      getProfileCalls({ pageSize: 50 }),
      getWeeklyCallVolume(),
      getCallOutcomeBreakdown(),
      getProfileCallMetrics(),
      getCallActivitySummary(),
      getCohortDashboard(),
    ])

    return {
      kpis: salesCore.kpis,
      reps: salesCore.reps,
      monthlyRevenue: salesCore.monthlyRevenue,
      salesHealth: salesCore.salesHealth,
      pipelineByRep,
      quotes: quotes.data,
      profileCalls: profileCalls.data,
      weeklyVolume,
      outcomeBreakdown,
      profileMetrics,
      callActivitySummary,
      cohorts,
    }
  },
  ['sales-dashboard-payload'],
  {
    revalidate: 60,
    tags: [SALES_DASHBOARD_CACHE_TAG],
  }
)

export async function GET() {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    return NextResponse.json(await getSalesDashboardPayload())
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
