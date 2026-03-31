import { Inngest } from 'inngest'

// Create Inngest client
export const inngest = new Inngest({
  id: 'medship-prometheus',
  // Event key and signing key are read from environment variables automatically:
  // INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY
})

// Event type definitions for type-safe event sending
export type InngestEvents = {
  // P1: Opportunity Closed → Fishbowl Sales Order
  'salesforce/opportunity.closed': {
    data: {
      opportunityId: string
      accountId: string
      amount: number
      closeDate: string
    }
  }

  // P2: Inventory Sync (scheduled)
  'fishbowl/inventory.sync': {
    data: {
      fullSync?: boolean
    }
  }

  // P3: QuickBooks Invoice/Payment Sync (scheduled)
  'quickbooks/invoice.sync': {
    data: {
      sinceDate?: string
    }
  }

  // P4: Shipment Tracking Sync (scheduled)
  'fishbowl/shipment.sync': {
    data: {
      dayRange?: number
    }
  }

  // P5: Quote PDF Generation
  'salesforce/quote.generate': {
    data: {
      quoteId: string
      opportunityId: string
    }
  }

  // P6: Low Stock Check (runs after inventory sync)
  'inventory/low-stock.check': {
    data: {
      triggeredBy: string
    }
  }

  // Manual retry trigger
  'sync/retry': {
    data: {
      eventId: string
      automation: string
    }
  }
}
