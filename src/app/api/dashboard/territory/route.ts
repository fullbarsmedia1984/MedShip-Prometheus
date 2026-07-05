import { NextResponse } from 'next/server'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import {
  getCustomersWithLocations,
  getRegionSummaries,
  getClientMapStats,
} from '@/lib/data'

export async function GET() {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const [customers, regions, stats] = await Promise.all([
      getCustomersWithLocations(),
      getRegionSummaries(),
      getClientMapStats(),
    ])

    return NextResponse.json({ customers, regions, stats })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
