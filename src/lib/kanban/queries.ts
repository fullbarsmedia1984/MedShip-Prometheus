import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { KanbanContext } from './identity'
import type {
  KanbanActivity,
  KanbanBoard,
  KanbanBoardMember,
  KanbanBoardStat,
  KanbanColumn,
  KanbanComment,
  KanbanTask,
  KanbanUser,
} from './types'

const USER_COLUMNS = 'id, full_name, email, job_role, avatar_color'
const BOARD_COLUMNS = 'id, slug, name, kind, owner_id, description, accent, position'
const TASK_COLUMNS =
  'id, board_id, column_id, title, description, priority, position, due_date, labels, created_by, created_at, completed_at'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_RE.test(value)
}

function sortBoards(boards: KanbanBoard[]): KanbanBoard[] {
  return boards.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.position - b.position ||
      a.name.localeCompare(b.name)
  )
}

/** Boards visible to the caller: execs see everything; others see department
 *  boards they belong to plus their own personal board. */
export async function boardsForContext(
  ctx: KanbanContext
): Promise<KanbanBoard[]> {
  const supabase = createAdminClient()

  if (ctx.isExec) {
    const { data, error } = await supabase.from('kanban_boards').select(BOARD_COLUMNS)
    if (error) throw error
    return sortBoards((data ?? []) as KanbanBoard[])
  }

  if (!ctx.identity) return []

  const { data: memberships, error: mErr } = await supabase
    .from('kanban_board_members')
    .select('board_id')
    .eq('user_id', ctx.identity.id)
  if (mErr) throw mErr
  const memberBoardIds = (memberships ?? []).map((m) => m.board_id as string)

  const orFilter = [
    `id.in.(${memberBoardIds.length ? memberBoardIds.join(',') : '00000000-0000-0000-0000-000000000000'})`,
    `owner_id.eq.${ctx.identity.id}`,
  ].join(',')

  const { data, error } = await supabase
    .from('kanban_boards')
    .select(BOARD_COLUMNS)
    .or(orFilter)
  if (error) throw error
  return sortBoards((data ?? []) as KanbanBoard[])
}

export async function getBoardBySlug(slug: string): Promise<KanbanBoard | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('kanban_boards')
    .select(BOARD_COLUMNS)
    .eq('slug', slug)
    .maybeSingle()
  return (data as KanbanBoard) ?? null
}

export async function getBoardById(id: string): Promise<KanbanBoard | null> {
  if (!isUuid(id)) return null
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('kanban_boards')
    .select(BOARD_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  return (data as KanbanBoard) ?? null
}

export async function canViewBoard(
  ctx: KanbanContext,
  board: KanbanBoard
): Promise<boolean> {
  if (ctx.isExec) return true
  if (!ctx.identity) return false
  if (board.kind === 'personal') return board.owner_id === ctx.identity.id
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('kanban_board_members')
    .select('user_id')
    .eq('board_id', board.id)
    .eq('user_id', ctx.identity.id)
    .maybeSingle()
  return data !== null
}

export async function canManageBoard(
  ctx: KanbanContext,
  board: KanbanBoard
): Promise<boolean> {
  if (ctx.isExec) return true
  if (!ctx.identity) return false
  if (board.kind === 'personal') return board.owner_id === ctx.identity.id
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('kanban_board_members')
    .select('member_role')
    .eq('board_id', board.id)
    .eq('user_id', ctx.identity.id)
    .eq('member_role', 'manager')
    .maybeSingle()
  return data !== null
}

type MemberRow = {
  member_role: 'manager' | 'member'
  user: (KanbanUser & { is_active: boolean }) | null
}

export async function boardMembers(boardId: string): Promise<KanbanBoardMember[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('kanban_board_members')
    .select(`member_role, user:kanban_users(${USER_COLUMNS}, is_active)`)
    .eq('board_id', boardId)
  if (error) throw error
  return ((data ?? []) as unknown as MemberRow[])
    .filter((r) => r.user?.is_active)
    .map((r) => ({ ...(r.user as KanbanUser), member_role: r.member_role }))
    .sort(
      (a, b) =>
        a.member_role.localeCompare(b.member_role) ||
        a.full_name.localeCompare(b.full_name)
    )
}

export async function boardColumns(boardId: string): Promise<KanbanColumn[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('kanban_columns')
    .select('id, board_id, name, position, wip_limit, is_done_column')
    .eq('board_id', boardId)
    .order('position')
  if (error) throw error
  return (data ?? []) as KanbanColumn[]
}

type TaskRow = KanbanTask & {
  assignee_rows?: { user: KanbanUser | null }[]
}

function flattenTask(row: TaskRow): KanbanTask {
  const assignees = (row.assignee_rows ?? [])
    .map((a) => a.user)
    .filter((u): u is KanbanUser => u !== null)
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
  const { assignee_rows: _drop, ...task } = row
  void _drop
  return { ...task, assignees }
}

export async function boardTasks(boardId: string): Promise<KanbanTask[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('kanban_tasks')
    .select(
      `${TASK_COLUMNS}, assignee_rows:kanban_task_assignees(user:kanban_users(${USER_COLUMNS}))`
    )
    .eq('board_id', boardId)
    .order('position')
  if (error) throw error
  return ((data ?? []) as unknown as TaskRow[]).map(flattenTask)
}

export async function getTaskWithAssignees(
  taskId: string
): Promise<KanbanTask | null> {
  if (!isUuid(taskId)) return null
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('kanban_tasks')
    .select(
      `${TASK_COLUMNS}, assignee_rows:kanban_task_assignees(user:kanban_users(${USER_COLUMNS}))`
    )
    .eq('id', taskId)
    .maybeSingle()
  return data ? flattenTask(data as unknown as TaskRow) : null
}

export async function taskComments(taskId: string): Promise<KanbanComment[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('kanban_comments')
    .select(`id, task_id, body, created_at, author:kanban_users(${USER_COLUMNS})`)
    .eq('task_id', taskId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as unknown as KanbanComment[]
}

export async function taskActivity(taskId: string): Promise<KanbanActivity[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('kanban_activity')
    .select(`id, verb, detail, created_at, actor:kanban_users(${USER_COLUMNS})`)
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw error
  return (data ?? []) as unknown as KanbanActivity[]
}

export async function allUsers(): Promise<KanbanUser[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('kanban_users')
    .select(USER_COLUMNS)
    .eq('is_active', true)
    .order('full_name')
  if (error) throw error
  return (data ?? []) as KanbanUser[]
}

export async function getUserById(id: string): Promise<KanbanUser | null> {
  if (!isUuid(id)) return null
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('kanban_users')
    .select(USER_COLUMNS)
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle()
  return (data as KanbanUser) ?? null
}

export async function boardStats(boardIds: string[]): Promise<KanbanBoardStat[]> {
  if (boardIds.length === 0) return []
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('kanban_tasks')
    .select('board_id, priority, completed_at')
    .in('board_id', boardIds)
  if (error) throw error
  const map = new Map<string, KanbanBoardStat>()
  for (const row of data ?? []) {
    const stat = map.get(row.board_id) ?? {
      board_id: row.board_id,
      total: 0,
      done: 0,
      urgent: 0,
    }
    stat.total += 1
    if (row.completed_at) stat.done += 1
    else if (row.priority === 'urgent') stat.urgent += 1
    map.set(row.board_id, stat)
  }
  return [...map.values()]
}

export async function membersForBoards(
  boardIds: string[]
): Promise<Record<string, KanbanUser[]>> {
  if (boardIds.length === 0) return {}
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('kanban_board_members')
    .select(`board_id, member_role, user:kanban_users(${USER_COLUMNS}, is_active)`)
    .in('board_id', boardIds)
  if (error) throw error
  const out: Record<string, KanbanUser[]> = {}
  for (const row of (data ?? []) as unknown as (MemberRow & { board_id: string })[]) {
    if (!row.user?.is_active) continue
    ;(out[row.board_id] ??= []).push(row.user as KanbanUser)
  }
  for (const list of Object.values(out)) {
    list.sort((a, b) => a.full_name.localeCompare(b.full_name))
  }
  return out
}

export async function logKanbanActivity(opts: {
  taskId: string | null
  boardId: string
  actorId: string | null
  verb: string
  detail?: Record<string, unknown>
}) {
  const supabase = createAdminClient()
  await supabase.from('kanban_activity').insert({
    task_id: opts.taskId,
    board_id: opts.boardId,
    actor_id: opts.actorId,
    verb: opts.verb,
    detail: opts.detail ?? {},
  })
}
