// Export all Inngest functions for the handler

export { sfOpportunityClosed } from './functions/sf-opportunity-closed'
export {
  inventorySync,
  inventorySyncManual,
} from './functions/inventory-sync'
export { retryFailedSyncs } from './functions/retry-failed-syncs'
export {
  qbInvoiceSync,
  qbInvoiceSyncManual,
} from './functions/qb-invoice-sync'
export {
  shipmentTrackingSync,
  shipmentTrackingSyncManual,
} from './functions/shipment-tracking-sync'
export { quotePdfGenerate } from './functions/quote-pdf-generate'
export {
  lowStockCheck,
  lowStockCheckManual,
} from './functions/low-stock-check'
export { sfFullSync } from './functions/sf-full-sync'
export { sfIncrementalSync } from './functions/sf-incremental-sync'

// Re-export client for convenience
export { inngest } from './client'
