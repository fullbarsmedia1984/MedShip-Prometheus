import { MANAGER_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import { ManagerView } from './manager-view'

// The parent layout admits every sales role (so reps can reach their
// scorecard); the manager view itself stays staff/manager+. Admins also
// get the rep-view preview picker (validate before inviting reps).
export default async function IncentivesPage() {
  const auth = await requireDashboardAuth(MANAGER_API_AUTH_OPTIONS)
  const canPreviewReps = auth.role === 'superadmin' || auth.role === 'admin'
  return <ManagerView canPreviewReps={canPreviewReps} />
}
