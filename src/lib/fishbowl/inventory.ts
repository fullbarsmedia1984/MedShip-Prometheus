import { getFishbowlClient } from './client'
import type { FBInventoryItem, FBApiResponse } from './types'

/**
 * Get all inventory items from Fishbowl
 * Used for full inventory sync (P2)
 */
export async function getAllInventory(): Promise<FBApiResponse<FBInventoryItem[]>> {
  // TODO: Implement in Phase 2
  const client = getFishbowlClient()
  return client.get<FBInventoryItem[]>('/api/parts/inventory')
}

/**
 * Get inventory for specific part numbers
 */
export async function getInventoryByPartNumbers(
  partNumbers: string[]
): Promise<FBApiResponse<FBInventoryItem[]>> {
  // TODO: Implement in Phase 2
  const client = getFishbowlClient()

  // Fishbowl may support batch lookup or require individual calls
  // This is a placeholder - actual implementation depends on Fishbowl API
  const params = new URLSearchParams()
  partNumbers.forEach((pn) => params.append('partNumber', pn))

  return client.get<FBInventoryItem[]>(`/api/parts/inventory?${params.toString()}`)
}

/**
 * Get inventory for a single part number
 */
export async function getInventoryByPartNumber(
  partNumber: string
): Promise<FBApiResponse<FBInventoryItem | null>> {
  // TODO: Implement in Phase 2
  const client = getFishbowlClient()
  const result = await client.get<FBInventoryItem[]>(
    `/api/parts/inventory?partNumber=${encodeURIComponent(partNumber)}`
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
 * Get inventory items below reorder point
 * Used for low stock alerts (P6)
 */
export async function getLowStockItems(
  reorderThreshold?: number
): Promise<FBApiResponse<FBInventoryItem[]>> {
  // TODO: Implement in Phase 6
  const client = getFishbowlClient()

  // This may need to be filtered client-side depending on Fishbowl API capabilities
  const result = await client.get<FBInventoryItem[]>('/api/parts/inventory')

  if (!result.success || !result.data) {
    return result
  }

  // Filter for low stock if threshold provided
  if (reorderThreshold !== undefined) {
    return {
      success: true,
      data: result.data.filter((item) => item.qtyAvailable <= reorderThreshold),
    }
  }

  return result
}
