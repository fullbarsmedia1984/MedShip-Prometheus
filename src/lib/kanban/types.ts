export type KanbanJobRole =
  | 'ceo'
  | 'coo'
  | 'territory_sales_rep'
  | 'bdr'
  | 'quotes_rep'
  | 'warehouse_ops_manager'
  | 'warehouse_staff'
  | 'it'
  | 'engineering'
  | 'customer_service'
  | 'purchasing_manager'
  | 'ar'
  | 'ap'
  | 'hr'

export type KanbanPriority = 'low' | 'medium' | 'high' | 'urgent'
export type KanbanBoardKind = 'department' | 'personal'
export type KanbanMemberRole = 'manager' | 'member'

export interface KanbanUser {
  id: string
  full_name: string
  email: string
  job_role: KanbanJobRole
  avatar_color: string
  profile_id?: string | null
}

export interface KanbanBoard {
  id: string
  slug: string
  name: string
  kind: KanbanBoardKind
  owner_id: string | null
  description: string | null
  accent: string
  position: number
}

export interface KanbanBoardMember extends KanbanUser {
  member_role: KanbanMemberRole
}

export interface KanbanColumn {
  id: string
  board_id: string
  name: string
  position: number
  wip_limit: number | null
  is_done_column: boolean
}

export interface KanbanTask {
  id: string
  board_id: string
  column_id: string
  title: string
  description: string | null
  priority: KanbanPriority
  position: number
  due_date: string | null
  labels: string[]
  created_by: string | null
  created_at: string
  completed_at: string | null
  assignees: KanbanUser[]
}

export interface KanbanComment {
  id: string
  task_id: string
  author: KanbanUser | null
  body: string
  created_at: string
}

export interface KanbanActivity {
  id: number
  verb: string
  detail: Record<string, unknown>
  actor: KanbanUser | null
  created_at: string
}

export interface KanbanBoardStat {
  board_id: string
  total: number
  done: number
  urgent: number
}
