import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireKanbanApiContext } from '@/lib/kanban/identity'
import { canManageBoard, getBoardById, isUuid } from '@/lib/kanban/queries'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireKanbanApiContext()
  if (!auth.authorized) return auth.response
  const ctx = auth.context
  const { id } = await params

  const board = await getBoardById(id)
  if (!board) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (board.kind !== 'department') {
    return NextResponse.json(
      { error: 'Personal boards have no members' },
      { status: 400 }
    )
  }
  if (!(await canManageBoard(ctx, board))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  if (!body?.userId || !isUuid(String(body.userId))) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }
  const memberRole = body.memberRole === 'manager' ? 'manager' : 'member'

  const supabase = createAdminClient()
  const { data: target } = await supabase
    .from('kanban_users')
    .select('id')
    .eq('id', String(body.userId))
    .eq('is_active', true)
    .maybeSingle()
  if (!target) {
    return NextResponse.json({ error: 'Unknown user' }, { status: 404 })
  }

  const { error } = await supabase.from('kanban_board_members').upsert({
    board_id: board.id,
    user_id: target.id,
    member_role: memberRole,
  })
  if (error) {
    return NextResponse.json({ error: 'Upsert failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true }, { status: 201 })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireKanbanApiContext()
  if (!auth.authorized) return auth.response
  const ctx = auth.context
  const { id } = await params

  const board = await getBoardById(id)
  if (!board) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(await canManageBoard(ctx, board))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const userId = new URL(request.url).searchParams.get('userId')
  if (!userId || !isUuid(userId)) {
    return NextResponse.json({ error: 'userId required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  await supabase
    .from('kanban_board_members')
    .delete()
    .eq('board_id', board.id)
    .eq('user_id', userId)
  return NextResponse.json({ ok: true })
}
