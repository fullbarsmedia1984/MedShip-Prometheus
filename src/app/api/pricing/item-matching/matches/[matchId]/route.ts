import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { reviewItemMatchSuggestion } from '@/lib/pricing/item-matching'

type MatchReviewContext = {
  params: Promise<{ matchId: string }>
}

export async function PATCH(request: NextRequest, context: MatchReviewContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { matchId } = await context.params
    const body = await request.json().catch(() => ({}))
    if (body.status !== 'approved' && body.status !== 'rejected') {
      return NextResponse.json({ error: 'status must be approved or rejected.' }, { status: 400 })
    }

    const result = await reviewItemMatchSuggestion(matchId, {
      status: body.status,
      reviewerId: auth.user?.id ?? null,
      notes: typeof body.notes === 'string' ? body.notes : null,
    })

    return NextResponse.json({ matchReview: result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
