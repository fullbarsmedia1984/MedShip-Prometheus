import { KITS_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import { getKitWorkbench } from '@/lib/kits/data'
import { KitsWorkbench } from '@/components/kits/KitsWorkbench'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Kit Assembly — MedShip Prometheus',
}

export default async function KitsPage() {
  const auth = await requireDashboardAuth(KITS_API_AUTH_OPTIONS)
  const workbench = await getKitWorkbench()
  const canImport =
    auth.role === 'superadmin' || auth.role === 'admin' || auth.role === 'staff'
  return <KitsWorkbench initial={workbench} canImport={canImport} />
}
