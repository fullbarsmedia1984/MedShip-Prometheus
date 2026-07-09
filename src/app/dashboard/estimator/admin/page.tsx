import { STAFF_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import { EstimatorAdminClient } from '@/components/estimator/EstimatorAdminClient'

export const metadata = {
  title: 'Estimator Admin — MedShip Prometheus',
}

export default async function EstimatorAdminPage() {
  // Estimator config (boxes, rules, dims browser/queue) stays staff-tier even
  // though the estimator tool itself is open to the sales tier.
  await requireDashboardAuth(STAFF_API_AUTH_OPTIONS)
  return <EstimatorAdminClient />
}
