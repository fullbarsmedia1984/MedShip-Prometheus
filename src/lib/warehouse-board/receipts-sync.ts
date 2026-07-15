import 'server-only'

import { getFishbowlClient } from '@/lib/fishbowl/client'
import { createAdminClient } from '@/lib/supabase/admin'

const RECEIPT_PAGE = 500
const INITIAL_HISTORY_DAYS = 45

type ReceiptRow = {
  receiptItemId: number
  receiptId: number
  poId: number
  poNum: string
  vendorId: number | null
  vendorName: string | null
  poItemId: number
  poLineItem: number | null
  partId: number | null
  partNum: string | null
  qty: number
  dateReceived: string
  receiptStatusId: number | null
  receiptStatusName: string | null
  receiptItemStatusId: number | null
  receiptItemStatusName: string | null
  trackingNum: string | null
  dateLastModified: string | null
}

export interface ReceiptSyncResult {
  mode: 'backfill' | 'incremental'
  receiptItems: number
  pages: number
  watermark: string | null
}

export function receiptPageSql(where: string): string {
  return `
    SELECT ri.id AS receiptItemId, ri.receiptId AS receiptId,
           p.id AS poId, p.num AS poNum,
           p.vendorId AS vendorId, v.name AS vendorName,
           pi.id AS poItemId, pi.poLineItem AS poLineItem,
           ri.partId AS partId, COALESCE(part.num, pi.partNum) AS partNum,
           ri.qty AS qty, ri.dateReceived AS dateReceived,
           r.statusId AS receiptStatusId, rs.name AS receiptStatusName,
           ri.statusId AS receiptItemStatusId,
           ris.name AS receiptItemStatusName,
           ri.trackingNum AS trackingNum,
           ri.dateLastModified AS dateLastModified
    FROM receiptitem ri
    JOIN receipt r ON r.id = ri.receiptId
    JOIN poitem pi ON pi.id = ri.poItemId
    JOIN po p ON p.id = pi.poId
    LEFT JOIN vendor v ON v.id = p.vendorId
    LEFT JOIN part ON part.id = ri.partId
    LEFT JOIN receiptstatus rs ON rs.id = r.statusId
    LEFT JOIN receiptitemstatus ris ON ris.id = ri.statusId
    WHERE ${where}
    ORDER BY ri.id
    LIMIT ${RECEIPT_PAGE}
  `
}

export async function syncReceiptEvents(): Promise<ReceiptSyncResult> {
  const client = getFishbowlClient()
  const supabase = createAdminClient()

  const { data: newest, error: newestError } = await supabase
    .from('fb_receipt_events')
    .select('source_last_modified, date_received')
    .order('source_last_modified', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (newestError) throw newestError

  const newestTimestamp = newest?.source_last_modified ?? newest?.date_received ?? null
  const mode: ReceiptSyncResult['mode'] = newestTimestamp
    ? 'incremental'
    : 'backfill'
  const watermark = newestTimestamp
    ? new Date(new Date(newestTimestamp).getTime() - 60 * 60_000)
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ')
    : null

  let cursor = 0
  let receiptItems = 0
  let pages = 0

  for (;;) {
    const window = watermark
      ? `COALESCE(ri.dateLastModified, ri.dateReceived) > '${watermark}'`
      : `ri.dateReceived >= DATE_SUB(NOW(), INTERVAL ${INITIAL_HISTORY_DAYS} DAY)`
    const where = [
      `ri.id > ${cursor}`,
      'ri.poItemId IS NOT NULL',
      'ri.dateReceived IS NOT NULL',
      window,
    ].join(' AND ')
    const rows = await client.dataQuery<ReceiptRow[]>(receiptPageSql(where))
    if (!Array.isArray(rows)) {
      throw new Error('Fishbowl receipt query returned a non-array response')
    }
    if (rows.length === 0) break
    cursor = rows[rows.length - 1].receiptItemId
    pages += 1
    const syncedAt = new Date().toISOString()

    const { error } = await supabase.from('fb_receipt_events').upsert(
      rows.map((row) => ({
        fishbowl_receipt_item_id: row.receiptItemId,
        fishbowl_receipt_id: row.receiptId,
        fishbowl_po_id: row.poId,
        po_number: String(row.poNum),
        vendor_id: row.vendorId,
        vendor_name: row.vendorName,
        fishbowl_po_line_id: row.poItemId,
        po_line_number: row.poLineItem,
        part_id: row.partId,
        part_number: row.partNum,
        qty_received: Number(row.qty ?? 0),
        date_received: row.dateReceived,
        receipt_status_id: row.receiptStatusId,
        receipt_status: row.receiptStatusName,
        receipt_item_status_id: row.receiptItemStatusId,
        receipt_item_status: row.receiptItemStatusName,
        tracking_number: row.trackingNum,
        source_last_modified: row.dateLastModified ?? row.dateReceived,
        raw_data: row,
        last_synced_at: syncedAt,
      })),
      { onConflict: 'fishbowl_receipt_item_id' }
    )
    if (error) throw error
    receiptItems += rows.length

    if (rows.length < RECEIPT_PAGE) break
  }

  return { mode, receiptItems, pages, watermark }
}
