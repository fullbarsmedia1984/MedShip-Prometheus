import { notFound } from 'next/navigation'
import { BoardClient } from '@/components/kanban/BoardClient'
import { requireKanbanPageContext } from '@/lib/kanban/identity'
import {
  allUsers,
  boardColumns,
  boardMembers,
  boardTasks,
  canManageBoard,
  canViewBoard,
  getBoardBySlug,
  getUserById,
} from '@/lib/kanban/queries'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Kanban board — MedShip Prometheus',
}

export default async function KanbanBoardPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const ctx = await requireKanbanPageContext()
  const { slug } = await params

  const board = await getBoardBySlug(slug)
  if (!board) notFound()
  if (!(await canViewBoard(ctx, board))) notFound()

  const [columns, tasks, members, manage] = await Promise.all([
    boardColumns(board.id),
    boardTasks(board.id),
    boardMembers(board.id),
    canManageBoard(ctx, board),
  ])

  // Assignable people: department board -> its members; personal -> the owner.
  const owner =
    board.kind === 'personal' && board.owner_id
      ? await getUserById(board.owner_id)
      : null
  const assignable = board.kind === 'personal' ? (owner ? [owner] : []) : members

  const directory =
    manage && board.kind === 'department' ? await allUsers() : []

  return (
    <div className="h-full">
      <BoardClient
        board={board}
        columns={columns}
        initialTasks={tasks}
        members={members}
        assignable={assignable}
        directory={directory}
        canManage={manage}
      />
    </div>
  )
}
