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

// ---------------------------------------------------------------------------
// Durable purchase-order sync (P11) — full po/poitem rows into
// fb_purchase_orders / fb_purchase_order_items. Incremental by
// po.dateLastModified with a 1-hour overlap; first run backfills everything
// in id-cursored pages.
// ---------------------------------------------------------------------------

type PoHeaderRow = {
  id: number
  num: string
  statusId: number | null
  typeId: number | null
  vendorId: number | null
  vendorName: string | null
  buyer: string | null
  vendorSO: string | null
  customerSO: string | null
  note: string | null
  dateCreated: string | null
  dateIssued: string | null
  dateCompleted: string | null
  dateFirstShip: string | null
  dateLastModified: string | null
}

type PoLineRow = {
  id: number
  poId: number
  poNum: string
  poLineItem: number | null
  partNum: string | null
  vendorPartNum: string | null
  description: string | null
  typeId: number | null
  statusId: number | null
  qtyToFulfill: number | null
  qtyFulfilled: number | null
  qtyPicked: number | null
  unitCost: number | null
  totalCost: number | null
  dateScheduledFulfillment: string | null
  dateLastFulfillment: string | null
}

const PO_PAGE = 500

function poHeaderSql(where: string): string {
  return `
    SELECT p.id AS id, p.num AS num, p.statusId AS statusId, p.typeId AS typeId,
           p.vendorId AS vendorId, v.name AS vendorName, p.buyer AS buyer,
           p.vendorSO AS vendorSO, p.customerSO AS customerSO, p.note AS note,
           p.dateCreated AS dateCreated, p.dateIssued AS dateIssued,
           p.dateCompleted AS dateCompleted, p.dateFirstShip AS dateFirstShip,
           p.dateLastModified AS dateLastModified
    FROM po p
    LEFT JOIN vendor v ON v.id = p.vendorId
    WHERE ${where}
    ORDER BY p.id
    LIMIT ${PO_PAGE}
  `
}

function poLineSql(poIds: number[]): string {
  return `
    SELECT pi.id AS id, pi.poId AS poId, p.num AS poNum,
           pi.poLineItem AS poLineItem, pi.partNum AS partNum,
           pi.vendorPartNum AS vendorPartNum, pi.description AS description,
           pi.typeId AS typeId, pi.statusId AS statusId,
           pi.qtyToFulfill AS qtyToFulfill, pi.qtyFulfilled AS qtyFulfilled,
           pi.qtyPicked AS qtyPicked, pi.unitCost AS unitCost,
           pi.totalCost AS totalCost,
           pi.dateScheduledFulfillment AS dateScheduledFulfillment,
           pi.dateLastFulfillment AS dateLastFulfillment
    FROM poitem pi
    JOIN po p ON p.id = pi.poId
    WHERE pi.poId IN (${poIds.join(',')})
  `
}

export interface PoSyncResult {
  mode: 'backfill' | 'incremental'
  pos: number
  lines: number
}

export async function syncPurchaseOrders(): Promise<PoSyncResult> {
  const client = getFishbowlClient()
  const supabase = createAdminClient()

  // Watermark: newest dateLastModified we already hold (minus 1h overlap).
  const { data: newest } = await supabase
    .from('fb_purchase_orders')
    .select('date_last_modified')
    .not('date_last_modified', 'is', null)
    .order('date_last_modified', { ascending: false })
    .limit(1)
    .maybeSingle()

  const mode: PoSyncResult['mode'] = newest ? 'incremental' : 'backfill'
  const watermark = newest
    ? new Date(new Date(newest.date_last_modified).getTime() - 3600_000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ')
    : null

  let cursor = 0
  let totalPos = 0
  let totalLines = 0

  for (;;) {
    const where = watermark
      ? `p.id > ${cursor} AND p.dateLastModified > '${watermark}'`
      : `p.id > ${cursor}`
    const headers = await client.dataQuery<PoHeaderRow[]>(poHeaderSql(where))
    if (!Array.isArray(headers) || headers.length === 0) break
    cursor = headers[headers.length - 1].id

    const syncedAt = new Date().toISOString()
    const { error: hdrErr } = await supabase.from('fb_purchase_orders').upsert(
      headers.map((h) => ({
        fishbowl_id: h.id,
        po_number: String(h.num),
        status_id: h.statusId,
        type_id: h.typeId,
        vendor_id: h.vendorId,
        vendor_name: h.vendorName,
        buyer: h.buyer,
        vendor_so: h.vendorSO,
        customer_so: h.customerSO,
        note: h.note,
        date_created: h.dateCreated,
        date_issued: h.dateIssued,
        date_completed: h.dateCompleted,
        date_first_ship: h.dateFirstShip,
        date_last_modified: h.dateLastModified,
        raw_data: h,
        last_synced_at: syncedAt,
      })),
      { onConflict: 'fishbowl_id' }
    )
    if (hdrErr) throw hdrErr
    totalPos += headers.length

    const lines = await client.dataQuery<PoLineRow[]>(
      poLineSql(headers.map((h) => h.id))
    )
    if (Array.isArray(lines) && lines.length > 0) {
      for (let i = 0; i < lines.length; i += 500) {
        const batch = lines.slice(i, i + 500)
        const { error: lineErr } = await supabase
          .from('fb_purchase_order_items')
          .upsert(
            batch.map((l) => ({
              fishbowl_line_id: l.id,
              fishbowl_po_id: l.poId,
              po_number: String(l.poNum),
              line_number: l.poLineItem,
              part_number: l.partNum,
              vendor_part_number: l.vendorPartNum,
              description: l.description,
              type_id: l.typeId,
              status_id: l.statusId,
              qty_to_fulfill: l.qtyToFulfill,
              qty_fulfilled: l.qtyFulfilled,
              qty_picked: l.qtyPicked,
              unit_cost: l.unitCost,
              total_cost: l.totalCost,
              date_scheduled: l.dateScheduledFulfillment,
              date_last_fulfillment: l.dateLastFulfillment,
              raw_data: l,
              last_synced_at: syncedAt,
            })),
            { onConflict: 'fishbowl_line_id' }
          )
        if (lineErr) throw lineErr
        totalLines += batch.length
      }
    }

    if (headers.length < PO_PAGE) break
  }

  return { mode, pos: totalPos, lines: totalLines }
}
