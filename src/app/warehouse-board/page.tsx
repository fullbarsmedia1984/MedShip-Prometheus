import { after } from 'next/server'
import {
  hasWarehouseGateAccess,
  isWarehouseBoardConfigured,
} from '@/lib/warehouse-board/gate'
import { getWallboardData } from '@/lib/warehouse-board/data'
import { ensureFreshPoLines } from '@/lib/warehouse-board/po-sync'
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

  // Refresh the open-PO cache after responding, so the board never blocks
  // on Fishbowl; the next 60s auto-refresh picks up the new data.
  after(() => ensureFreshPoLines())

  const data = await getWallboardData()
  return <WallboardClient data={data} />
}
