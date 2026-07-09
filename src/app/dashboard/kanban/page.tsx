import { PageHeader } from '@/components/layout/PageHeader'
import { BoardsHome } from '@/components/kanban/BoardsHome'
import { requireKanbanPageContext } from '@/lib/kanban/identity'
import {
  boardsForContext,
  boardStats,
  membersForBoards,
} from '@/lib/kanban/queries'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Kanban — MedShip Prometheus',
}

export default async function KanbanPage() {
  const ctx = await requireKanbanPageContext()
  const boards = await boardsForContext(ctx)
  const departmentIds = boards
    .filter((b) => b.kind === 'department')
    .map((b) => b.id)
  const [stats, members] = await Promise.all([
    boardStats(boards.map((b) => b.id)),
    membersForBoards(departmentIds),
  ])

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Kanban"
        description="Operational task boards for every department — access scoped by role and board membership."
      />

      {boards.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center shadow-[var(--shadow-card)]">
          <p className="text-sm font-medium text-card-foreground">
            Your account isn&apos;t linked to the Kanban directory yet.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask an admin to link your profile to a person in the Kanban
            directory (or add you to a department board) and this page will
            light up.
          </p>
        </div>
      ) : (
        <BoardsHome
          identity={ctx.identity}
          isExec={ctx.isExec}
          boards={boards}
          stats={Object.fromEntries(stats.map((s) => [s.board_id, s]))}
          members={members}
        />
      )}
    </div>
  )
}
