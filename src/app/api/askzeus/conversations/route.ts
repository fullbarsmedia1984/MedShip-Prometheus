import { NextResponse } from 'next/server'
import { ASKZEUS_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { listConversations } from '@/lib/askzeus/persistence'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireApiAuth(ASKZEUS_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    // Dev auth bypass has no real user → no stored conversations.
    if (!auth.user?.id) {
      return NextResponse.json({ conversations: [] })
    }

    const conversations = await listConversations(auth.user.id)
    return NextResponse.json({ conversations })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
