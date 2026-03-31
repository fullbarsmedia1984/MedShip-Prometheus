// =============================================================================
// Fishbowl Shipment Tracking — Phase 2 Stubs (P4)
// =============================================================================

import type { FishbowlClient } from './client';

/**
 * Get shipments for a specific Sales Order.
 * TODO: Implement in Phase 2 (P4: Shipment Tracking)
 */
export async function getShipmentsBySalesOrder(
  _client: FishbowlClient,
  salesOrderNumber: string
): Promise<unknown[]> {
  console.log(
    `[P4 STUB] getShipmentsBySalesOrder called for ${salesOrderNumber}`
  );
  return [];
}

/**
 * Get all shipments created/modified since a given timestamp.
 * TODO: Implement in Phase 2 (P4: Shipment Tracking)
 */
export async function getRecentShipments(
  _client: FishbowlClient,
  since: Date
): Promise<unknown[]> {
  console.log(
    `[P4 STUB] getRecentShipments called since ${since.toISOString()}`
  );
  return [];
}
