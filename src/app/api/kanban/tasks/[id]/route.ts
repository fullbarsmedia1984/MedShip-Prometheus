import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireKanbanApiContext, type KanbanContext } from '@/lib/kanban/identity'
import {
  canViewBoard,
  getBoardById,
  getTaskWithAssignees,
  isUuid,
  logKanbanActivity,
} from '@/lib/kanban/queries'
import type { KanbanBoard, KanbanPriority } from '@/lib/kanban/types'

const PRIORITIES: KanbanPriority[] = ['low', 'medium', 'high', 'urgent']

type LoadedTask = {
  id: string
  board_id: string
  column_id: string
  title: string
  description: string | null
  priority: KanbanPriority
  due_date: string | null
  labels: string[]
  column_name: string
}

async function loadTaskForContext(
  id: string,
  ctx: KanbanContext
): Promise<
  | { task: LoadedTask; board: KanbanBoard }
  | { error: NextResponse<{ error: string }> }
> {
  if (!isUuid(id)) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('kanban_tasks')
    .select(
      'id, board_id, column_id, title, description, priority, due_date, labels, column:kanban_columns(name)'
    )
    .eq('id', id)
    .maybeSingle()
  if (!data) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  }
  const board = await getBoardById(data.board_id as string)
  if (!board || !(await canViewBoard(ctx, board))) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const column = data.column as unknown as { name: string } | null
  const task: LoadedTask = {
    id: data.id,
    board_id: data.board_id,
    column_id: data.column_id,
    title: data.title,
    description: data.description,
    priority: data.priority,
    due_date: data.due_date,
    labels: data.labels ?? [],
    column_name: column?.name ?? '',
  }
  return { task, board }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireKanbanApiContext()
  if (!auth.authorized) return auth.response
  const ctx = auth.context
  const { id } = await params

  const loaded = await loadTaskForContext(id, ctx)
  if ('error' in loaded) return loaded.error
  const { task, board } = loaded

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Bad body' }, { status: 400 })

  const supabase = createAdminClient()
  const actorId = ctx.identity?.id ?? null

  // --- move between/within columns ---
  if (body.columnId !== undefined || body.position !== undefined) {
    const columnId: string = body.columnId ?? task.column_id
    const { data: column } = await supabase
      .from('kanban_columns')
      .select('id, name, is_done_column')
      .eq('id', columnId)
      .eq('board_id', board.id)
      .maybeSingle()
    if (!column) {
      return NextResponse.json({ error: 'Column not on board' }, { status: 400 })
    }

    let position: number
    if (typeof body.position === 'number') {
      position = body.position
    } else {
      const { data: last } = await supabase
        .from('kanban_tasks')
        .select('position')
        .eq('column_id', columnId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle()
      position = ((last?.position as number) ?? 0) + 1024
    }

    const done = column.is_done_column as boolean
    const update: Record<string, unknown> = {
      column_id: columnId,
      position,
      updated_at: new Date().toISOString(),
    }
    if (done) update.completed_at = new Date().toISOString()
    else update.completed_at = null

    const { error } = await supabase
      .from('kanban_tasks')
      .update(update)
      .eq('id', id)
    if (error) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }

    if (columnId !== task.column_id) {
      await logKanbanActivity({
        taskId: id,
        boardId: board.id,
        actorId,
        verb: done ? 'completed' : 'moved',
        detail: { from: task.column_name, to: column.name },
      })
    }
  }

  // --- field updates ---
  if (
    body.title !== undefined ||
    body.description !== undefined ||
    body.priority !== undefined ||
    body.dueDate !== undefined ||
    body.labels !== undefined
  ) {
    const title =
      body.title !== undefined ? String(body.title).trim() : task.title
    if (!title) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
    }
    const { error } = await supabase
      .from('kanban_tasks')
      .update({
        title,
        description:
          body.description !== undefined
            ? body.description
              ? String(body.description)
              : null
            : task.description,
        priority:
          body.priority !== undefined && PRIORITIES.includes(body.priority)
            ? body.priority
            : task.priority,
        due_date:
          body.dueDate !== undefined
            ? body.dueDate
              ? String(body.dueDate)
              : null
            : task.due_date,
        labels:
          body.labels !== undefined && Array.isArray(body.labels)
            ? body.labels.map(String).slice(0, 8)
            : task.labels,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }
    await logKanbanActivity({
      taskId: id,
      boardId: board.id,
      actorId,
      verb: 'updated',
      detail: { fields: Object.keys(body) },
    })
  }

  // --- set assignees ---
  if (body.assigneeIds !== undefined && Array.isArray(body.assigneeIds)) {
    const ids: string[] = body.assigneeIds.map(String).filter(isUuid)
    await supabase.from('kanban_task_assignees').delete().eq('task_id', id)
    if (ids.length > 0) {
      await supabase
        .from('kanban_task_assignees')
        .upsert(ids.map((userId) => ({ task_id: id, user_id: userId })))
    }
    await logKanbanActivity({
      taskId: id,
      boardId: board.id,
      actorId,
      verb: 'assigned',
      detail: { count: ids.length },
    })
  }

  const fresh = await getTaskWithAssignees(id)
  return NextResponse.json({ task: fresh })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireKanbanApiContext()
  if (!auth.authorized) return auth.response
  const ctx = auth.context
  const { id } = await params

  const loaded = await loadTaskForContext(id, ctx)
  if ('error' in loaded) return loaded.error

  await logKanbanActivity({
    taskId: null,
    boardId: loaded.board.id,
    actorId: ctx.identity?.id ?? null,
    verb: 'deleted',
    detail: { title: loaded.task.title },
  })
  const supabase = createAdminClient()
  await supabase.from('kanban_tasks').delete().eq('id', id)
  return NextResponse.json({ ok: true })
}
