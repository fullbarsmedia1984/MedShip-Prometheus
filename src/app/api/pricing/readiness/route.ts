import { NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getPricingReadinessReport } from '@/lib/pricing/readiness'

export async function GET() {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const report = await getPricingReadinessReport()
    return NextResponse.json({ report })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
