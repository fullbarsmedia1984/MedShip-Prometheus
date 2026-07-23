import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireKanbanApiContext, type KanbanContext } from '@/lib/kanban/identity'
import {
  canViewBoard,
  getBoardById,
  isUuid,
  logKanbanActivity,
  taskActivity,
  taskComments,
} from '@/lib/kanban/queries'
import type { KanbanBoard } from '@/lib/kanban/types'

async function authorizeTask(
  id: string,
  ctx: KanbanContext
): Promise<KanbanBoard | NextResponse<{ error: string }>> {
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('kanban_tasks')
    .select('board_id')
    .eq('id', id)
    .maybeSingle()
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const board = await getBoardById(data.board_id as string)
  if (!board || !(await canViewBoard(ctx, board))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return board
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireKanbanApiContext()
  if (!auth.authorized) return auth.response
  const { id } = await params

  const board = await authorizeTask(id, auth.context)
  if (board instanceof NextResponse) return board

  const [comments, activity] = await Promise.all([
    taskComments(id),
    taskActivity(id),
  ])
  return NextResponse.json({ comments, activity })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireKanbanApiContext()
  if (!auth.authorized) return auth.response
  const ctx = auth.context
  const { id } = await params

  const board = await authorizeTask(id, ctx)
  if (board instanceof NextResponse) return board

  const body = await request.json().catch(() => null)
  const text = body?.body ? String(body.body).trim() : ''
  if (!text) {
    return NextResponse.json({ error: 'Body required' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data: comment, error } = await supabase
    .from('kanban_comments')
    .insert({ task_id: id, author_id: ctx.identity?.id ?? null, body: text })
    .select('id, task_id, body, created_at')
    .single()
  if (error || !comment) {
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
  }

  await logKanbanActivity({
    taskId: id,
    boardId: board.id,
    actorId: ctx.identity?.id ?? null,
    verb: 'commented',
    detail: {},
  })
  return NextResponse.json(
    { comment: { ...comment, author: ctx.identity } },
    { status: 201 }
  )
}
