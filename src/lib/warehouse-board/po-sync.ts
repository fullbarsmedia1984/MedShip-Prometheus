import 'server-only'
import { getFishbowlClient } from '@/lib/fishbowl/client'
import { createAdminClient } from '@/lib/supabase/admin'

// Open-PO cache refresh for the wallboard. Pulls open purchase-order lines
// (Issued / partially received) straight from Fishbowl via the data-query
// endpoint and replaces fb_open_po_lines. Cheap: ~600 rows.
const OPEN_PO_SQL = `
  SELECT p.num AS poNum, p.statusId AS statusId, part.num AS partNum,
         pi.qtyToFulfill AS qtyToFulfill,
         COALESCE(pi.qtyFulfilled, 0) AS qtyFulfilled,
         pi.dateScheduledFulfillment AS expectedAt
  FROM po p
  JOIN poitem pi ON pi.poId = p.id
  JOIN part ON part.id = pi.partId
  WHERE p.statusId IN (20, 30, 40, 50)
    AND pi.qtyToFulfill > COALESCE(pi.qtyFulfilled, 0)
`

type OpenPoRow = {
  poNum: string
  statusId: number
  partNum: string
  qtyToFulfill: number
  qtyFulfilled: number
  expectedAt: string | null
}

export async function syncOpenPoLines(): Promise<number> {
  const client = getFishbowlClient()
  const rows = await client.dataQuery<OpenPoRow[]>(OPEN_PO_SQL)
  if (!Array.isArray(rows)) return 0

  const supabase = createAdminClient()
  const syncedAt = new Date().toISOString()
  const payload = rows.map((r) => ({
    po_number: String(r.poNum),
    status_id: r.statusId,
    part_number: String(r.partNum),
    qty_open: Number(r.qtyToFulfill) - Number(r.qtyFulfilled),
    expected_date: r.expectedAt ? String(r.expectedAt).slice(0, 10) : null,
    synced_at: syncedAt,
  }))

  // Replace-all: insert the fresh set first, then drop the previous
  // generation, so a mid-refresh reader never sees an empty table.
  if (payload.length > 0) {
    const { error: insErr } = await supabase.from('fb_open_po_lines').insert(payload)
    if (insErr) throw insErr
  }
  const { error: delErr } = await supabase
    .from('fb_open_po_lines')
    .delete()
    .lt('synced_at', syncedAt)
  if (delErr) throw delErr
  return payload.length
}

/** Refresh the cache when it is older than maxAgeMinutes (or empty).
 *  Never throws — the wallboard tolerates a stale cache. */
export async function ensureFreshPoLines(maxAgeMinutes = 15): Promise<void> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('fb_open_po_lines')
      .select('synced_at')
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const ageMs = data ? Date.now() - new Date(data.synced_at).getTime() : Infinity
    if (ageMs > maxAgeMinutes * 60_000) {
      await syncOpenPoLines()
    }
  } catch (err) {
    console.error('[wallboard] open-PO refresh failed:', err)
  }
}
