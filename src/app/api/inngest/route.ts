import { serve } from 'inngest/next'
import {
  inngest,
  sfOpportunityClosed,
  inventorySync,
  inventorySyncManual,
  retryFailedSyncs,
  qbInvoiceSync,
  qbInvoiceSyncManual,
  shipmentTrackingSync,
  shipmentTrackingSyncManual,
  quotePdfGenerate,
  lowStockCheck,
  lowStockCheckManual,
} from '@/inngest'

// Inngest webhook handler
// This endpoint receives events from Inngest and routes them to the appropriate function
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    // P1: Opportunity → Sales Order
    sfOpportunityClosed,

    // P2: Inventory Sync
    inventorySync,
    inventorySyncManual,

    // Retry handler
    retryFailedSyncs,

    // P3: QuickBooks Invoice Sync
    qbInvoiceSync,
    qbInvoiceSyncManual,

    // P4: Shipment Tracking
    shipmentTrackingSync,
    shipmentTrackingSyncManual,

    // P5: Quote PDF Generation
    quotePdfGenerate,

    // P6: Low Stock Check
    lowStockCheck,
    lowStockCheckManual,
  ],
})
