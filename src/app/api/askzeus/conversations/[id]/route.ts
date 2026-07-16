import { NextRequest, NextResponse } from 'next/server'
import { ASKZEUS_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import {
  deleteConversation,
  getConversationMessages,
  getOwnedConversation,
  renameConversation,
} from '@/lib/askzeus/persistence'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiAuth(ASKZEUS_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response
    if (!auth.user?.id) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { id } = await context.params
    const conversation = await getOwnedConversation(id, auth.user.id)
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const messages = await getConversationMessages(id)
    return NextResponse.json({ conversation, messages })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiAuth(ASKZEUS_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response
    if (!auth.user?.id) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { title?: string } | null
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    const renamed = await renameConversation(id, auth.user.id, title)
    if (!renamed) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireApiAuth(ASKZEUS_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response
    if (!auth.user?.id) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const { id } = await context.params
    const deleted = await deleteConversation(id, auth.user.id)
    if (!deleted) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
