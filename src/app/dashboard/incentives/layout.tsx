import { SALES_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'

// Loosest common gate: reps must reach /scorecard. The manager view and
// /admin apply their own stricter role checks.
export default async function IncentivesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireDashboardAuth(SALES_API_AUTH_OPTIONS)

  return <>{children}</>
}
