import 'server-only'

import { chicagoTodayIso } from '@/lib/business-days'
import {
  chicagoMidnightUtc,
  chicagoNextMidnightUtc,
} from '@/lib/incentive/dates'
import { isKitOrderNumber } from '@/lib/kits/order-number'
import { shipDeadline } from '@/lib/kits/workdays'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  buildReceivingOrders,
  type OpenDemandFact,
  type ReceiptFact,
  type ReceivingOrder,
  type ReceivingSource,
} from './receiving-rules'

const AUTOMATION = 'P14_RECEIPTS_SYNC'
const PAGE_SIZE = 1000

export interface ReceivingData {
  generatedAt: string
  chicagoDate: string
  source: ReceivingSource
  sourceLabel: string
  isBeta: boolean
  syncStatus: string | null
  syncAgeMinutes: number | null
  orders: ReceivingOrder[]
  totals: {
    purchaseOrders: number
    linesReceived: number
    quantityReceived: number
    crossDockParts: number
    crossDockOrders: number
  }
  error: string | null
}

async function pageAll<T>(
  build: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>
): Promise<T[]> {
  const output: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const rows = data ?? []
    output.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return output
}

function ageMinutes(timestamp: string | null, now: Date): number | null {
  return timestamp
    ? Math.max(0, Math.round((now.getTime() - new Date(timestamp).getTime()) / 60_000))
    : null
}

function normalizePart(partNumber: unknown): string | null {
  const value = String(partNumber ?? '').trim()
  return value ? value.toUpperCase() : null
}

async function readReceiptFacts(
  start: string,
  end: string
): Promise<ReceiptFact[]> {
  const supabase = createAdminClient()
  const rows = await pageAll<Record<string, unknown>>((from, to) =>
    supabase
      .from('fb_receipt_events')
      .select(
        'fishbowl_receipt_item_id, fishbowl_receipt_id, po_number, vendor_name, fishbowl_po_line_id, part_number, qty_received, date_received, receipt_status, receipt_item_status'
      )
      .gte('date_received', start)
      .lt('date_received', end)
      .order('date_received', { ascending: false })
      .range(from, to)
  )
  return rows.map((row) => ({
    receiptItemId: Number(row.fishbowl_receipt_item_id),
    receiptId: Number(row.fishbowl_receipt_id),
    poNumber: String(row.po_number),
    vendorName: row.vendor_name ? String(row.vendor_name) : null,
    poLineId: Number(row.fishbowl_po_line_id),
    partNumber: normalizePart(row.part_number),
    quantity: Number(row.qty_received ?? 0),
    receivedAt: String(row.date_received),
    receiptStatus: row.receipt_status ? String(row.receipt_status) : null,
    receiptItemStatus: row.receipt_item_status
      ? String(row.receipt_item_status)
      : null,
  }))
}

async function readFallbackFacts(
  start: string,
  end: string
): Promise<{ facts: ReceiptFact[]; lastSyncedAt: string | null }> {
  const supabase = createAdminClient()
  const rows = await pageAll<Record<string, unknown>>((from, to) =>
    supabase
      .from('fb_purchase_order_items')
      .select(
        'fishbowl_line_id, po_number, part_number, qty_fulfilled, date_last_fulfillment, last_synced_at'
      )
      .gte('date_last_fulfillment', start)
      .lt('date_last_fulfillment', end)
      .order('date_last_fulfillment', { ascending: false })
      .range(from, to)
  )
  const poNumbers = [...new Set(rows.map((row) => String(row.po_number)))]
  const vendorByPo = new Map<string, string>()
  for (let i = 0; i < poNumbers.length; i += 100) {
    const { data, error } = await supabase
      .from('fb_purchase_orders')
      .select('po_number, vendor_name')
      .in('po_number', poNumbers.slice(i, i + 100))
    if (error) throw error
    for (const row of data ?? []) {
      vendorByPo.set(
        String(row.po_number),
        row.vendor_name ? String(row.vendor_name) : 'Unknown vendor'
      )
    }
  }
  const lastSyncedAt = rows
    .map((row) => (row.last_synced_at ? String(row.last_synced_at) : null))
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null
  return {
    facts: rows.map((row) => ({
      receiptItemId: `fallback-${row.fishbowl_line_id}`,
      receiptId: `fallback-${row.fishbowl_line_id}`,
      poNumber: String(row.po_number),
      vendorName: vendorByPo.get(String(row.po_number)) ?? null,
      poLineId: Number(row.fishbowl_line_id),
      partNumber: normalizePart(row.part_number),
      // The fallback proves that the PO line changed today, but the cache only
      // stores cumulative fulfillment. Use a one-line marker for inclusion;
      // the beta UI intentionally does not present a received-unit total.
      quantity: 1,
      receivedAt: String(row.date_last_fulfillment),
      receiptStatus: null,
      receiptItemStatus: null,
    })),
    lastSyncedAt,
  }
}

async function readTotalLinesByPo(
  poNumbers: string[]
): Promise<Map<string, number>> {
  const supabase = createAdminClient()
  const lineIdsByPo = new Map<string, Set<string>>()
  for (let i = 0; i < poNumbers.length; i += 100) {
    const batch = poNumbers.slice(i, i + 100)
    const rows = await pageAll<Record<string, unknown>>((from, to) =>
      supabase
        .from('fb_purchase_order_items')
        .select('fishbowl_line_id, po_number, part_number, qty_to_fulfill')
        .in('po_number', batch)
        .order('fishbowl_line_id')
        .range(from, to)
    )
    for (const row of rows) {
      if (!normalizePart(row.part_number) || Number(row.qty_to_fulfill ?? 0) <= 0) {
        continue
      }
      const poNumber = String(row.po_number)
      const ids = lineIdsByPo.get(poNumber) ?? new Set<string>()
      ids.add(String(row.fishbowl_line_id))
      lineIdsByPo.set(poNumber, ids)
    }
  }
  return new Map(
    [...lineIdsByPo.entries()].map(([poNumber, ids]) => [poNumber, ids.size])
  )
}

async function readOpenDemandByPart(): Promise<Map<string, OpenDemandFact[]>> {
  const supabase = createAdminClient()
  const { data: openOrders, error: openError } = await supabase
    .from('fb_sales_orders')
    .select('so_number, status, date_scheduled')
    .in('status', ['Issued', 'In Progress'])
  if (openError) throw openError

  const soNumbers = (openOrders ?? []).map((row) => String(row.so_number))
  const orderBySo = new Map(
    (openOrders ?? []).map((row) => [String(row.so_number), row])
  )
  const kitSos = soNumbers.filter(isKitOrderNumber)
  const kitPriorityBySo = new Map<string, string>()
  for (let i = 0; i < kitSos.length; i += 100) {
    const { data, error } = await supabase
      .from('kit_orders')
      .select('so_number, absolute_need_by, transit_days')
      .in('so_number', kitSos.slice(i, i + 100))
    if (error) throw error
    for (const row of data ?? []) {
      if (row.absolute_need_by) {
        kitPriorityBySo.set(
          String(row.so_number),
          shipDeadline(
            String(row.absolute_need_by),
            Number(row.transit_days ?? 0)
          )
        )
      }
    }
  }

  const demandByPart = new Map<string, OpenDemandFact[]>()
  for (let i = 0; i < soNumbers.length; i += 100) {
    const batch = soNumbers.slice(i, i + 100)
    const rows = await pageAll<Record<string, unknown>>((from, to) =>
      supabase
        .from('fb_sales_order_items')
        .select(
          'sales_order_number, part_number, quantity, quantity_fulfilled, quantity_picked:raw_data->>quantityPicked, line_type:raw_data->type->>name'
        )
        .in('sales_order_number', batch)
        .order('id')
        .range(from, to)
    )
    for (const row of rows) {
      const lineType = row.line_type ? String(row.line_type) : null
      if (lineType !== 'Sale' && lineType !== 'Kit') continue
      const partNumber = normalizePart(row.part_number)
      if (!partNumber) continue
      const quantity = Number(row.quantity ?? 0)
      const picked = Number(row.quantity_picked ?? row.quantity_fulfilled ?? 0)
      const remaining = Math.max(0, quantity - picked)
      if (remaining <= 0) continue
      const soNumber = String(row.sales_order_number)
      const order = orderBySo.get(soNumber)
      const list = demandByPart.get(partNumber) ?? []
      list.push({
        soNumber,
        kind: isKitOrderNumber(soNumber) ? 'kit' : 'sales',
        remaining,
        priorityDate:
          kitPriorityBySo.get(soNumber) ??
          (order?.date_scheduled ? String(order.date_scheduled).slice(0, 10) : null),
      })
      demandByPart.set(partNumber, list)
    }
  }
  return demandByPart
}

export async function getReceivingData(now: Date = new Date()): Promise<ReceivingData> {
  const generatedAt = now.toISOString()
  const chicagoDate = chicagoTodayIso(now)
  const start = chicagoMidnightUtc(chicagoDate).toISOString()
  const end = chicagoNextMidnightUtc(chicagoDate).toISOString()
  const empty = (
    error: string,
    syncStatus: string | null = null,
    syncAgeMinutes: number | null = null
  ): ReceivingData => ({
    generatedAt,
    chicagoDate,
    source: 'unavailable',
    sourceLabel: 'Unavailable',
    isBeta: true,
    syncStatus,
    syncAgeMinutes,
    orders: [],
    totals: {
      purchaseOrders: 0,
      linesReceived: 0,
      quantityReceived: 0,
      crossDockParts: 0,
      crossDockOrders: 0,
    },
    error,
  })

  try {
    const supabase = createAdminClient()
    const { data: schedule, error: scheduleError } = await supabase
      .from('sync_schedules')
      .select('last_run_at, last_run_status')
      .eq('automation', AUTOMATION)
      .maybeSingle()
    if (scheduleError) throw scheduleError

    const durableReady = schedule?.last_run_status === 'success'
    let facts: ReceiptFact[]
    let source: ReceivingSource
    let sourceLabel: string
    let syncTimestamp = schedule?.last_run_at
      ? String(schedule.last_run_at)
      : null
    if (durableReady) {
      facts = await readReceiptFacts(start, end)
      source = 'receipt_events'
      sourceLabel = 'Fishbowl receipt events'
    } else {
      const fallback = await readFallbackFacts(start, end)
      facts = fallback.facts
      source = 'po_line_fallback'
      sourceLabel = 'PO fulfillment fallback · beta'
      syncTimestamp = syncTimestamp ?? fallback.lastSyncedAt
    }

    const poNumbers = [...new Set(facts.map((fact) => fact.poNumber))]
    const [totalLinesByPo, demandByPart] = await Promise.all([
      readTotalLinesByPo(poNumbers),
      source === 'receipt_events' && facts.length > 0
        ? readOpenDemandByPart()
        : Promise.resolve(new Map<string, OpenDemandFact[]>()),
    ])
    const orders = buildReceivingOrders({
      facts,
      totalLinesByPo,
      demandByPart,
      includeCrossDock: source === 'receipt_events',
    })
    const matchedOrders = new Set(
      orders.flatMap((order) =>
        order.crossDockCandidates.flatMap((candidate) =>
          candidate.demand.map((demand) => demand.soNumber)
        )
      )
    )

    return {
      generatedAt,
      chicagoDate,
      source,
      sourceLabel,
      isBeta: source !== 'receipt_events',
      syncStatus: schedule?.last_run_status
        ? String(schedule.last_run_status)
        : null,
      syncAgeMinutes: ageMinutes(syncTimestamp, now),
      orders,
      totals: {
        purchaseOrders: orders.length,
        linesReceived: orders.reduce(
          (sum, order) => sum + order.linesReceivedToday,
          0
        ),
        quantityReceived:
          source === 'receipt_events'
            ? orders.reduce(
                (sum, order) => sum + order.quantityReceivedToday,
                0
              )
            : 0,
        crossDockParts: orders.reduce(
          (sum, order) => sum + order.crossDockCandidates.length,
          0
        ),
        crossDockOrders: matchedOrders.size,
      },
      error: null,
    }
  } catch (error) {
    console.error('[wallboard] receiving data failed:', error)
    return empty('Receiving data is unavailable. Check the P14 sync and database logs.')
  }
}
