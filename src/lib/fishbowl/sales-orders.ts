import { getFishbowlClient } from './client'
import type { FBSalesOrder, FBApiResponse } from './types'

interface CreateSOResult {
  soNum: string
  status: string
}

/**
 * Create a new Sales Order in Fishbowl
 * Called when SF Opportunity is closed-won (P1)
 */
export async function createSalesOrder(
  order: FBSalesOrder
): Promise<FBApiResponse<CreateSOResult>> {
  // TODO: Implement in Phase 1
  const client = getFishbowlClient()

  // Map to Fishbowl API format
  const payload = {
    customerName: order.customerName,
    customerPO: order.customerPO,
    carrier: order.carrier,
    dateScheduledFulfillment: order.dateScheduledFulfillment,
    billTo: order.billTo,
    shipTo: order.shipTo,
    items: order.items.map((item) => ({
      productNumber: item.productNumber,
      description: item.description,
      qty: item.quantity,
      price: item.unitPrice,
      uom: item.uom || 'Each',
      taxable: item.taxable ?? false,
    })),
    note: order.note,
  }

  return client.post<CreateSOResult>('/api/sales-orders', payload)
}

/**
 * Get Sales Order by SO number
 */
export async function getSalesOrder(
  soNum: string
): Promise<FBApiResponse<FBSalesOrder | null>> {
  // TODO: Implement in Phase 1
  const client = getFishbowlClient()
  return client.get<FBSalesOrder | null>(`/api/sales-orders/${encodeURIComponent(soNum)}`)
}

/**
 * Get Sales Orders by status
 */
export async function getSalesOrdersByStatus(
  status: string
): Promise<FBApiResponse<FBSalesOrder[]>> {
  // TODO: Implement as needed
  const client = getFishbowlClient()
  return client.get<FBSalesOrder[]>(`/api/sales-orders?status=${encodeURIComponent(status)}`)
}

/**
 * Update Sales Order status
 */
export async function updateSalesOrderStatus(
  soNum: string,
  status: string
): Promise<FBApiResponse<{ success: boolean }>> {
  // TODO: Implement as needed
  const client = getFishbowlClient()
  return client.put<{ success: boolean }>(`/api/sales-orders/${encodeURIComponent(soNum)}`, {
    status,
  })
}

/**
 * Cancel a Sales Order
 */
export async function cancelSalesOrder(
  soNum: string,
  reason?: string
): Promise<FBApiResponse<{ success: boolean }>> {
  // TODO: Implement as needed
  const client = getFishbowlClient()
  return client.put<{ success: boolean }>(`/api/sales-orders/${encodeURIComponent(soNum)}/cancel`, {
    reason,
  })
}
