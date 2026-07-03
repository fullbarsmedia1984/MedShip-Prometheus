import { STAFF_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'

export default async function TerritoryLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireDashboardAuth(STAFF_API_AUTH_OPTIONS)

  return <>{children}</>
}
