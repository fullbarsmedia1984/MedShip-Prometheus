import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { reviewMigrationException } from '@/lib/pricing/contract-migration'
import type { ExceptionReviewStatus } from '@/lib/pricing/contract-migration/types'

type ExceptionReviewContext = {
  params: Promise<{ id: string; exceptionId: string }>
}

const REVIEW_STATUSES = new Set(['open', 'acknowledged', 'resolved', 'waived', 'rejected'])

export async function PATCH(request: NextRequest, context: ExceptionReviewContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id, exceptionId } = await context.params
    const body = await request.json().catch(() => ({}))
    const status = typeof body.status === 'string' ? body.status : ''
    if (!REVIEW_STATUSES.has(status)) {
      return NextResponse.json({ error: 'Invalid exception review status.' }, { status: 400 })
    }

    const result = await reviewMigrationException(id, exceptionId, {
      status: status as ExceptionReviewStatus,
      reviewerId: auth.user?.id ?? null,
      resolution: typeof body.resolution === 'string' ? body.resolution : null,
      resolutionNotes: typeof body.resolutionNotes === 'string' ? body.resolutionNotes : null,
    })

    return NextResponse.json({ exception: result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
