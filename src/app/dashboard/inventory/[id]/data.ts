import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { AutomationType, SyncStatus } from '@/types'

type InventorySnapshotRow = {
  id: string
  part_number: string
  part_description: string | null
  qty_on_hand: number | string | null
  qty_allocated: number | string | null
  qty_available: number | string | null
  uom: string | null
  location: string | null
  fishbowl_part_id: number | null
  last_synced_at: string | null
  sf_product_id: string | null
}

type ReorderRuleRow = {
  id: string
  part_number: string
  part_description: string | null
  reorder_point: number | string
  reorder_quantity: number | string
  preferred_supplier: string | null
  is_active: boolean | null
  last_triggered_at: string | null
  created_at: string | null
}

type SfProductRow = {
  sf_id: string
  product_code: string | null
  name: string
  description: string | null
  family: string | null
  is_active: boolean | null
  qty_on_hand: number | string | null
  qty_available: number | string | null
  last_inventory_sync: string | null
  last_synced_at: string | null
}

type SyncScheduleRow = {
  automation: AutomationType
  cron_expression: string
  is_active: boolean | null
  last_run_at: string | null
  next_run_at: string | null
  last_run_status: string | null
  last_run_duration_ms: number | null
  records_processed: number | null
}

type SyncEventRow = {
  id: string
  created_at: string
  automation: AutomationType
  source_record_id: string | null
  target_record_id: string | null
  status: SyncStatus
  error_message: string | null
  completed_at: string | null
}

export type InventoryDetail = {
  snapshot: InventorySnapshotRow
  reorderRule: ReorderRuleRow | null
  sfProduct: SfProductRow | null
  syncSchedule: SyncScheduleRow | null
  latestSyncEvent: SyncEventRow | null
  itemSyncEvent: SyncEventRow | null
}

export function toNumber(value: number | string | null | undefined): number {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : 0
}

export function getStockStatus(
  qtyAvailable: number,
  reorderPoint: number
): { label: string; tone: 'success' | 'warning' | 'danger' } {
  if (qtyAvailable <= 0) return { label: 'Out of Stock', tone: 'danger' }
  if (qtyAvailable <= reorderPoint) return { label: 'Low Stock', tone: 'warning' }
  return { label: 'In Stock', tone: 'success' }
}

export async function getInventoryDetail(id: string): Promise<InventoryDetail | null> {
  const supabase = createAdminClient()
  const decodedId = decodeURIComponent(id)

  const snapshotById = await supabase
    .from('inventory_snapshot')
    .select(
      'id, part_number, part_description, qty_on_hand, qty_allocated, qty_available, uom, location, fishbowl_part_id, last_synced_at, sf_product_id'
    )
    .eq('id', decodedId)
    .maybeSingle()

  if (snapshotById.error) throw snapshotById.error

  const snapshotByPartNumber = snapshotById.data
    ? { data: null, error: null }
    : await supabase
        .from('inventory_snapshot')
        .select(
          'id, part_number, part_description, qty_on_hand, qty_allocated, qty_available, uom, location, fishbowl_part_id, last_synced_at, sf_product_id'
        )
        .eq('part_number', decodedId)
        .maybeSingle()

  const snapshotError = snapshotByPartNumber.error
  const snapshot = snapshotById.data ?? snapshotByPartNumber.data

  if (snapshotError) throw snapshotError
  if (!snapshot) return null

  const row = snapshot as InventorySnapshotRow
  const sfProductQuery = row.sf_product_id
    ? supabase
        .from('sf_products')
        .select(
          'sf_id, product_code, name, description, family, is_active, qty_on_hand, qty_available, last_inventory_sync, last_synced_at'
        )
        .eq('sf_id', row.sf_product_id)
        .maybeSingle()
    : supabase
        .from('sf_products')
        .select(
          'sf_id, product_code, name, description, family, is_active, qty_on_hand, qty_available, last_inventory_sync, last_synced_at'
        )
        .eq('product_code', row.part_number)
        .maybeSingle()

  const eventFields =
    'id, created_at, automation, source_record_id, target_record_id, status, error_message, completed_at'
  const itemEventQueries = [
    supabase
      .from('sync_events')
      .select(eventFields)
      .eq('automation', 'P2_INVENTORY_SYNC')
      .eq('source_record_id', row.part_number)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('sync_events')
      .select(eventFields)
      .eq('automation', 'P2_INVENTORY_SYNC')
      .eq('target_record_id', row.part_number)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    ...(row.sf_product_id
      ? [
          supabase
            .from('sync_events')
            .select(eventFields)
            .eq('automation', 'P2_INVENTORY_SYNC')
            .eq('source_record_id', row.sf_product_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('sync_events')
            .select(eventFields)
            .eq('automation', 'P2_INVENTORY_SYNC')
            .eq('target_record_id', row.sf_product_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]
      : []),
  ]

  const [reorderResult, sfProductResult, scheduleResult, latestSyncResult, ...itemSyncResults] =
    await Promise.all([
      supabase
        .from('reorder_rules')
        .select(
          'id, part_number, part_description, reorder_point, reorder_quantity, preferred_supplier, is_active, last_triggered_at, created_at'
        )
        .eq('part_number', row.part_number)
        .maybeSingle(),
      sfProductQuery,
      supabase
        .from('sync_schedules')
        .select(
          'automation, cron_expression, is_active, last_run_at, next_run_at, last_run_status, last_run_duration_ms, records_processed'
        )
        .eq('automation', 'P2_INVENTORY_SYNC')
        .maybeSingle(),
      supabase
        .from('sync_events')
        .select(eventFields)
        .eq('automation', 'P2_INVENTORY_SYNC')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      ...itemEventQueries,
    ])

  if (reorderResult.error) throw reorderResult.error
  if (sfProductResult.error) throw sfProductResult.error
  if (scheduleResult.error) throw scheduleResult.error
  if (latestSyncResult.error) throw latestSyncResult.error
  for (const itemSyncResult of itemSyncResults) {
    if (itemSyncResult.error) throw itemSyncResult.error
  }

  const itemSyncEvent = itemSyncResults
    .map((result) => result.data as SyncEventRow | null)
    .filter((event): event is SyncEventRow => Boolean(event))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null

  return {
    snapshot: row,
    reorderRule: (reorderResult.data as ReorderRuleRow | null) ?? null,
    sfProduct: (sfProductResult.data as SfProductRow | null) ?? null,
    syncSchedule: (scheduleResult.data as SyncScheduleRow | null) ?? null,
    latestSyncEvent: (latestSyncResult.data as SyncEventRow | null) ?? null,
    itemSyncEvent,
  }
}
