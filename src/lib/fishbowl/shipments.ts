import { getFishbowlClient } from './client'
import type { FBShipment, FBApiResponse } from './types'

/**
 * Get shipments for a Sales Order
 */
export async function getShipmentsBySO(
  soNum: string
): Promise<FBApiResponse<FBShipment[]>> {
  // TODO: Implement in Phase 4
  const client = getFishbowlClient()
  return client.get<FBShipment[]>(`/api/shipments?soNum=${encodeURIComponent(soNum)}`)
}

/**
 * Get all recent shipments (last N days)
 * Used for tracking sync (P4)
 */
export async function getRecentShipments(
  days: number = 7
): Promise<FBApiResponse<FBShipment[]>> {
  // TODO: Implement in Phase 4
  const client = getFishbowlClient()
  const sinceDate = new Date()
  sinceDate.setDate(sinceDate.getDate() - days)
  const isoDate = sinceDate.toISOString().split('T')[0]

  return client.get<FBShipment[]>(`/api/shipments?dateShippedAfter=${isoDate}`)
}

/**
 * Get shipments with tracking numbers that haven't been synced to SF
 */
export async function getUnSyncedShipments(): Promise<FBApiResponse<FBShipment[]>> {
  // TODO: Implement in Phase 4
  // This may need to be filtered on our side by checking against sync_events
  const client = getFishbowlClient()
  return client.get<FBShipment[]>('/api/shipments?status=shipped')
}

/**
 * Get shipment by tracking number
 */
export async function getShipmentByTracking(
  trackingNumber: string
): Promise<FBApiResponse<FBShipment | null>> {
  // TODO: Implement in Phase 4
  const client = getFishbowlClient()
  const result = await client.get<FBShipment[]>(
    `/api/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}`
  )

  if (!result.success) {
    return { success: false, error: result.error }
  }

  return {
    success: true,
    data: result.data?.[0] || null,
  }
}

/**
 * Get shipment by ID
 */
export async function getShipmentById(
  shipmentId: number
): Promise<FBApiResponse<FBShipment | null>> {
  // TODO: Implement in Phase 4
  const client = getFishbowlClient()
  return client.get<FBShipment | null>(`/api/shipments/${shipmentId}`)
}
