import { SALES_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'

export default async function CatalogLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Every signed-in role may browse the catalog; supplier buy prices are
  // stripped server-side for sales roles (see the catalog API routes).
  await requireDashboardAuth(SALES_API_AUTH_OPTIONS)

  return <>{children}</>
}
