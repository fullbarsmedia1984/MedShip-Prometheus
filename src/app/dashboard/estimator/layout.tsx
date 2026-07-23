import { ESTIMATOR_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'

export default async function EstimatorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireDashboardAuth(ESTIMATOR_API_AUTH_OPTIONS)

  return <>{children}</>
}
