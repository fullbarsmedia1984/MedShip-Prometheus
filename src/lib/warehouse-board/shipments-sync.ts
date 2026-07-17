import 'server-only'
import type { FishbowlClient } from '@/lib/fishbowl/client'
import { createAdminClient } from '@/lib/supabase/admin'

// Rolling shipments cache for the wallboard's Shipped lane. A shipment
// leaving the dock counts as shipped even while the SO is still In
// Progress (partial shipment) or before the cached SO status flips.
const RECENT_SHIPMENTS_SQL = `
  SELECT s.num AS shipNum, so.num AS soNum, s.statusId AS statusId,
         s.dateShipped AS dateShipped, s.cartonCount AS cartonCount
  FROM ship s
  JOIN so ON so.id = s.soId
  WHERE s.statusId = 30
    AND s.dateShipped >= DATE_SUB(NOW(), INTERVAL 10 DAY)
`

type ShipRow = {
  shipNum: string
  soNum: string
  statusId: number
  dateShipped: string
  cartonCount: number | null
}

// Callers own the Fishbowl session (withFishbowlSession) so every login is
// paired with a logout — an unclosed session holds a Fishbowl license seat
// until the server-side timeout.
export async function syncRecentShipments(client: FishbowlClient): Promise<number> {
  const rows = await client.dataQuery<ShipRow[]>(RECENT_SHIPMENTS_SQL)
  if (!Array.isArray(rows)) return 0

  const supabase = createAdminClient()
  const syncedAt = new Date().toISOString()
  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('fb_recent_shipments').insert(
      rows.map((r) => ({
        ship_number: String(r.shipNum),
        so_number: String(r.soNum),
        status_id: r.statusId,
        date_shipped: r.dateShipped,
        carton_count: r.cartonCount,
        synced_at: syncedAt,
      }))
    )
    if (insErr) throw insErr
  }
  // Replace-all: fresh generation first, then drop the previous one.
  const { error: delErr } = await supabase
    .from('fb_recent_shipments')
    .delete()
    .lt('synced_at', syncedAt)
  if (delErr) throw delErr
  return rows.length
}
