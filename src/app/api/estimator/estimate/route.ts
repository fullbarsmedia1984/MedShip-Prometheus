import { NextRequest, NextResponse } from 'next/server'
import { ESTIMATOR_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { generateEstimate } from '@/lib/estimator/estimate-service'
import { SalesOrderNotFoundError } from '@/lib/estimator/so-service'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ESTIMATOR_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = (await request.json()) as { soNumber?: string }
    const soNumber = body.soNumber?.trim()
    if (!soNumber) {
      return NextResponse.json({ error: 'soNumber is required' }, { status: 400 })
    }

    const createdBy = auth.user?.email ?? (auth.isDevBypass ? 'dev-bypass' : null)
    const { estimate, summary } = await generateEstimate(soNumber, createdBy)
    return NextResponse.json({ estimate, summary })
  } catch (error) {
    if (error instanceof SalesOrderNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 })
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
