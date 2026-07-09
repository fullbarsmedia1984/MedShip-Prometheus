import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireKanbanApiContext } from '@/lib/kanban/identity'
import {
  canViewBoard,
  getBoardById,
  getTaskWithAssignees,
  logKanbanActivity,
} from '@/lib/kanban/queries'
import type { KanbanPriority } from '@/lib/kanban/types'

const PRIORITIES: KanbanPriority[] = ['low', 'medium', 'high', 'urgent']

export async function POST(request: Request) {
  const auth = await requireKanbanApiContext()
  if (!auth.authorized) return auth.response
  const ctx = auth.context

  const body = await request.json().catch(() => null)
  if (!body?.boardId || !body?.columnId || !String(body.title ?? '').trim()) {
    return NextResponse.json(
      { error: 'boardId, columnId, title required' },
      { status: 400 }
    )
  }

  const board = await getBoardById(String(body.boardId))
  if (!board) {
    return NextResponse.json({ error: 'Board not found' }, { status: 404 })
  }
  if (!(await canViewBoard(ctx, board))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createAdminClient()
  const { data: column } = await supabase
    .from('kanban_columns')
    .select('id')
    .eq('id', String(body.columnId))
    .eq('board_id', board.id)
    .maybeSingle()
  if (!column) {
    return NextResponse.json({ error: 'Column not on board' }, { status: 400 })
  }

  const { data: last } = await supabase
    .from('kanban_tasks')
    .select('position')
    .eq('column_id', column.id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const priority: KanbanPriority = PRIORITIES.includes(body.priority)
    ? body.priority
    : 'medium'
  const labels: string[] = Array.isArray(body.labels)
    ? body.labels.map(String).slice(0, 8)
    : []

  const { data: task, error } = await supabase
    .from('kanban_tasks')
    .insert({
      board_id: board.id,
      column_id: column.id,
      title: String(body.title).trim(),
      description: body.description ? String(body.description) : null,
      priority,
      due_date:
        typeof body.dueDate === 'string' && body.dueDate ? body.dueDate : null,
      labels,
      position: ((last?.position as number) ?? 0) + 1024,
      created_by: ctx.identity?.id ?? null,
    })
    .select('id, title')
    .single()
  if (error || !task) {
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
  }

  const assigneeIds: string[] = Array.isArray(body.assigneeIds)
    ? body.assigneeIds.map(String)
    : []
  if (assigneeIds.length > 0) {
    await supabase
      .from('kanban_task_assignees')
      .upsert(assigneeIds.map((userId) => ({ task_id: task.id, user_id: userId })))
  }

  await logKanbanActivity({
    taskId: task.id,
    boardId: board.id,
    actorId: ctx.identity?.id ?? null,
    verb: 'created',
    detail: { title: task.title },
  })

  const fresh = await getTaskWithAssignees(task.id)
  return NextResponse.json({ task: fresh }, { status: 201 })
}
