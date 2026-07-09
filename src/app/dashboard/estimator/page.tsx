import {
  STAFF_API_AUTH_OPTIONS,
  requireDashboardAuth,
  type AppRole,
} from '@/lib/auth'
import { EstimatorClient } from '@/components/estimator/EstimatorClient'

export const metadata = {
  title: 'Packaging Estimator — MedShip Prometheus',
}

export default async function EstimatorPage() {
  const auth = await requireDashboardAuth()
  const canManage =
    auth.role !== null &&
    (STAFF_API_AUTH_OPTIONS.roles as readonly AppRole[]).includes(auth.role)
  return <EstimatorClient canManage={canManage} />
}
