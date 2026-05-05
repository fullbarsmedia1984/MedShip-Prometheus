import { NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import {
  getSalesKpis,
  getEnhancedSalesReps,
  getMonthlyRepRevenue,
  getPipelineByRep,
  getQuotes,
  getProfileCalls,
  getProfileCallMetrics,
  getWeeklyCallVolume,
  getCallOutcomeBreakdown,
  getTopCompetitorKeywords,
} from '@/lib/data'

export async function GET() {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const [
      kpis,
      reps,
      monthlyRevenue,
      pipelineByRep,
      quotes,
      profileCalls,
      weeklyVolume,
      outcomeBreakdown,
      profileMetrics,
      competitorKeywords,
    ] = await Promise.all([
      getSalesKpis(),
      getEnhancedSalesReps(),
      getMonthlyRepRevenue(),
      getPipelineByRep(),
      getQuotes({ pageSize: 40 }),
      getProfileCalls({ pageSize: 50 }),
      getWeeklyCallVolume(),
      getCallOutcomeBreakdown(),
      getProfileCallMetrics(),
      getTopCompetitorKeywords(10),
    ])

    return NextResponse.json({
      kpis,
      reps,
      monthlyRevenue,
      pipelineByRep,
      quotes: quotes.data,
      profileCalls: profileCalls.data,
      weeklyVolume,
      outcomeBreakdown,
      profileMetrics,
      competitorKeywords,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
