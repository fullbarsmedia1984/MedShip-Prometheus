import {
  hasWarehouseGateAccess,
  isWarehouseBoardConfigured,
} from '@/lib/warehouse-board/gate'
import { getWallboardData } from '@/lib/warehouse-board/data'
import { WallboardClient } from '@/components/warehouse-board/WallboardClient'
import { WallboardGate } from '@/components/warehouse-board/WallboardGate'

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

  if (!(await hasWarehouseGateAccess())) {
    return <WallboardGate />
  }

  // PO + inventory freshness is owned by the P11/P2 Inngest crons
  // (business-hours schedule); the board renders from the caches.
  const data = await getWallboardData()
  return <WallboardClient data={data} />
}
