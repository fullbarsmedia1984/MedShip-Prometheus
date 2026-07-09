import { NextRequest, NextResponse } from 'next/server'
import { ESTIMATOR_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { listEstimates } from '@/lib/estimator/repositories'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ESTIMATOR_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const soNumber = request.nextUrl.searchParams.get('so') ?? undefined
    const estimates = await listEstimates(soNumber)
    return NextResponse.json({ estimates })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
