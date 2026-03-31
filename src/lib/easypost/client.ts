import EasyPost from '@easypost/api'
import type { EPShipment, EPAddress, EPParcel, EPTracker } from './types'

// Type for EasyPost client instance
type EasyPostClient = InstanceType<typeof EasyPost>

// Singleton client instance
let clientInstance: EasyPostClient | null = null

/**
 * Get EasyPost client instance
 */
export function getEasyPostClient(): EasyPostClient {
  if (!clientInstance) {
    const apiKey = process.env.EASYPOST_API_KEY

    if (!apiKey) {
      throw new Error('Missing EasyPost API key: EASYPOST_API_KEY')
    }

    clientInstance = new EasyPost(apiKey)
  }

  return clientInstance
}

/**
 * Create a shipment and get rates
 * TODO: Implement in Phase 4 Path B
 */
export async function createShipment(
  fromAddress: EPAddress,
  toAddress: EPAddress,
  parcel: EPParcel
): Promise<EPShipment> {
  // TODO: Implement in Phase 4 Path B
  const client = getEasyPostClient()

  const shipment = await client.Shipment.create({
    from_address: fromAddress,
    to_address: toAddress,
    parcel: parcel,
  })

  return shipment as unknown as EPShipment
}

/**
 * Buy a rate and generate label
 * TODO: Implement in Phase 4 Path B
 */
export async function buyShipment(
  shipmentId: string,
  rateId: string
): Promise<EPShipment> {
  // TODO: Implement in Phase 4 Path B
  const client = getEasyPostClient()

  // Use the static buy method
  const purchased = await client.Shipment.buy(shipmentId, rateId)

  return purchased as unknown as EPShipment
}

/**
 * Create a tracker for existing tracking number
 * TODO: Implement in Phase 4
 */
export async function createTracker(
  trackingCode: string,
  carrier?: string
): Promise<EPTracker> {
  // TODO: Implement in Phase 4
  const client = getEasyPostClient()

  const tracker = await client.Tracker.create({
    tracking_code: trackingCode,
    carrier: carrier,
  })

  return tracker as unknown as EPTracker
}

/**
 * Get tracker status
 * TODO: Implement in Phase 4
 */
export async function getTracker(trackerId: string): Promise<EPTracker> {
  // TODO: Implement in Phase 4
  const client = getEasyPostClient()

  const tracker = await client.Tracker.retrieve(trackerId)

  return tracker as unknown as EPTracker
}

/**
 * Test EasyPost connection
 */
export async function testEasyPostConnection(): Promise<{
  success: boolean
  error?: string
}> {
  try {
    const apiKey = process.env.EASYPOST_API_KEY

    if (!apiKey) {
      return {
        success: false,
        error: 'EasyPost API key not configured',
      }
    }

    // Test by creating a simple address verification
    const client = getEasyPostClient()
    await client.Address.create({
      street1: '417 Montgomery Street',
      city: 'San Francisco',
      state: 'CA',
      zip: '94104',
      country: 'US',
    })

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
