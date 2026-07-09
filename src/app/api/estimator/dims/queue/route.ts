import { NextRequest, NextResponse } from 'next/server'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getDimsQueue } from '@/lib/estimator/repositories'

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const limitParam = Number(request.nextUrl.searchParams.get('limit'))
    const limit =
      Number.isInteger(limitParam) && limitParam > 0 && limitParam <= 500 ? limitParam : 100
    const queue = await getDimsQueue(limit)
    return NextResponse.json({ queue })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
