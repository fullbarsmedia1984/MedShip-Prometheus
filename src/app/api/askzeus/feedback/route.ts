import { NextRequest, NextResponse } from 'next/server'
import { ASKZEUS_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ASKZEUS_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = (await request.json().catch(() => null)) as {
      conversationId?: string
      rating?: string
      comment?: string
      question?: string
      answerPreview?: string
    } | null

    const rating = body?.rating
    if (rating !== 'up' && rating !== 'down') {
      return NextResponse.json({ error: 'rating must be up or down' }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { error } = await supabase.from('askzeus_feedback').insert({
      // 'ephemeral' (dev bypass) is not a real conversation row
      conversation_id:
        body?.conversationId && body.conversationId !== 'ephemeral'
          ? body.conversationId
          : null,
      user_id: auth.user?.id ?? null,
      rating,
      comment:
        typeof body?.comment === 'string' && body.comment.trim()
          ? body.comment.trim().slice(0, 1000)
          : null,
      question:
        typeof body?.question === 'string' ? body.question.slice(0, 1000) : null,
      answer_preview:
        typeof body?.answerPreview === 'string'
          ? body.answerPreview.slice(0, 1000)
          : null,
    })
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
