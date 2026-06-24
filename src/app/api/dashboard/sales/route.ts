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
  getTopCompetitorKeywords,
} from '@/lib/data'
import type { ProfileCallMetricsResult, KeywordResult } from '@/lib/data'
import type { SeedPipelineByRep, SeedQuote, SeedProfileCall, SeedWeeklyCallVolume } from '@/lib/seed-data'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    const payload = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    return [payload.message, payload.details, payload.hint, payload.code]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(' | ') || 'Unknown error'
  }
  return typeof error === 'string' ? error : 'Unknown error'
}

async function optionalPart<T>(label: string, load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load()
  } catch (error) {
    console.error(`Sales dashboard optional section failed: ${label}`, error)
    return fallback
  }
}

const EMPTY_PROFILE_METRICS: ProfileCallMetricsResult = {
  totalMTD: 0,
  totalLastMonth: 0,
  conversionRate: 0,
  connectRate: 0,
  avgDuration: 0,
  byRep: [],
}

const getSalesDashboardPayload = unstable_cache(
  async () => {
    const salesCore = await getSalesDashboardCore()
    const [
      pipelineByRep,
      quotes,
      profileCalls,
      weeklyVolume,
      outcomeBreakdown,
      profileMetrics,
      competitorKeywords,
    ] = await Promise.all([
      optionalPart<SeedPipelineByRep[]>('pipeline by rep', () => getPipelineByRep(), []),
      optionalPart('quote activity', () => getQuotes({ pageSize: 40 }), { data: [] as SeedQuote[], total: 0, page: 1, pageSize: 40, totalPages: 0 }),
      optionalPart('profile call log', () => getProfileCalls({ pageSize: 50 }), { data: [] as SeedProfileCall[], total: 0, page: 1, pageSize: 50, totalPages: 0 }),
      optionalPart<SeedWeeklyCallVolume[]>('weekly call volume', () => getWeeklyCallVolume(), []),
      optionalPart<Array<{ outcome: string; count: number; percentage: number; color: string }>>('call outcome breakdown', () => getCallOutcomeBreakdown(), []),
      optionalPart<ProfileCallMetricsResult>('profile metrics', () => getProfileCallMetrics(), EMPTY_PROFILE_METRICS),
      optionalPart<KeywordResult[]>('competitor keywords', () => getTopCompetitorKeywords(10), []),
    ])

    return {
      kpis: salesCore.kpis,
      reps: salesCore.reps,
      monthlyRevenue: salesCore.monthlyRevenue,
      monthlyBusinessRevenue: salesCore.monthlyBusinessRevenue,
      salesHealth: salesCore.salesHealth,
      pipelineByRep,
      quotes: quotes.data,
      profileCalls: profileCalls.data,
      weeklyVolume,
      outcomeBreakdown,
      profileMetrics,
      competitorKeywords,
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
    console.error('Sales dashboard API failed', error)
    return NextResponse.json(
      { error: errorMessage(error) },
      { status: 500 }
    )
  }
}
