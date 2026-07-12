import { KITS_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import { getKitKpis, getKitWorkbench } from '@/lib/kits/data'
import { KitsWorkbench } from '@/components/kits/KitsWorkbench'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Kit Assembly — MedShip Prometheus',
}

export default async function KitsPage() {
  const auth = await requireDashboardAuth(KITS_API_AUTH_OPTIONS)
  const [workbench, kpis] = await Promise.all([
    getKitWorkbench(),
    getKitKpis(90),
  ])
  const canImport =
    auth.role === 'superadmin' || auth.role === 'admin' || auth.role === 'staff'
  return <KitsWorkbench initial={workbench} kpis={kpis} canImport={canImport} />
}
