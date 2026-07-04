import { MANAGER_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import { ManagerView } from './manager-view'

// The parent layout admits every sales role (so reps can reach their
// scorecard); the manager view itself stays staff/manager+.
export default async function IncentivesPage() {
  await requireDashboardAuth(MANAGER_API_AUTH_OPTIONS)
  return <ManagerView />
}
