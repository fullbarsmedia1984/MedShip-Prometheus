import { ADMIN_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireDashboardAuth(ADMIN_API_AUTH_OPTIONS)

  return <>{children}</>
}
