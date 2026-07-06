import { ADMIN_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'

export default async function CatalogLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Hercules supplier catalog data is Class P — admin only.
  await requireDashboardAuth(ADMIN_API_AUTH_OPTIONS)

  return <>{children}</>
}
