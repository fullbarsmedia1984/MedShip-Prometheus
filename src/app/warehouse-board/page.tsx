import {
  hasWarehouseGateAccess,
  isWarehouseBoardConfigured,
} from '@/lib/warehouse-board/gate'
import { getAuthContext, type AppRole } from '@/lib/auth'
import { getWallboardData } from '@/lib/warehouse-board/data'
import { getKitGalaxyData } from '@/lib/warehouse-board/galaxy-data'
import { WallboardClient } from '@/components/warehouse-board/WallboardClient'
import { WallboardGate } from '@/components/warehouse-board/WallboardGate'

// Signed-in roles that may view the board without the TV password.
const WALLBOARD_ROLES: AppRole[] = ['superadmin', 'admin', 'staff', 'warehouse']

async function hasRoleAccess(): Promise<boolean> {
  const auth = await getAuthContext()
  return (
    auth !== null &&
    !auth.pendingTwoFactor &&
    auth.role !== null &&
    WALLBOARD_ROLES.includes(auth.role)
  )
}

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Warehouse Wallboard — Medical Shipment',
}

export default async function WarehouseBoardPage() {
  if (!isWarehouseBoardConfigured()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0F1A2E] p-8 text-center text-slate-300">
        <p>
          Wallboard not configured — set <code>WAREHOUSE_BOARD_PASSWORD</code>.
        </p>
      </div>
    )
  }

  // Two ways in: the shared TV password (kiosks) or a signed-in session with
  // a wallboard-tier role.
  if (!(await hasWarehouseGateAccess()) && !(await hasRoleAccess())) {
    return <WallboardGate />
  }

  // PO + inventory freshness is owned by the P11/P2 Inngest crons
  // (business-hours schedule); the board renders from the caches.
  const [data, galaxy] = await Promise.all([
    getWallboardData(),
    getKitGalaxyData(),
  ])
  return <WallboardClient data={data} galaxy={galaxy} />
}
