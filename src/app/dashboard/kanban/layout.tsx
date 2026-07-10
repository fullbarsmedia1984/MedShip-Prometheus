import { KANBAN_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'

export default async function KanbanLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireDashboardAuth(KANBAN_API_AUTH_OPTIONS)

  return <>{children}</>
}
