import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { createKnowledge, listKnowledge } from '@/lib/askzeus/knowledge'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response
    const entries = await listKnowledge()
    return NextResponse.json({ entries })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = (await request.json().catch(() => null)) as { content?: string } | null
    const content = typeof body?.content === 'string' ? body.content.trim() : ''
    if (!content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }
    if (content.length > 2000) {
      return NextResponse.json(
        { error: 'content exceeds 2000 characters' },
        { status: 400 }
      )
    }

    const entry = await createKnowledge(content, auth.user?.id ?? null)
    return NextResponse.json({ entry })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
