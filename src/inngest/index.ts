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
export {
  fishbowlSalesOrdersSync,
  fishbowlSalesOrdersSyncManual,
  fishbowlSalesOrdersBackfillPages,
  fishbowlSalesOrdersDetailHydrate,
} from './functions/fishbowl-sales-orders-sync'
export { sfFullSync } from './functions/sf-full-sync'
export { sfIncrementalSync } from './functions/sf-incremental-sync'
export {
  herculesCatalogIngest,
  herculesCatalogDeltaCron,
} from './functions/hercules-catalog-ingest'
export {
  incentivePayoutFreeze,
  incentiveRecompute,
  incentiveRecomputeManual,
} from './functions/incentive-recompute'
export {
  ceoDailyBriefing,
  incentiveWeeklyDigest,
} from './functions/incentive-comms'
export {
  purchaseOrdersSync,
  purchaseOrdersSyncManual,
} from './functions/purchase-orders-sync'
export {
  shipmentsCacheSync,
  shipmentsCacheSyncManual,
} from './functions/shipments-sync'
export {
  receiptsSync,
  receiptsSyncManual,
} from './functions/receipts-sync'
export {
  productPartsSync,
  productPartsSyncManual,
} from './functions/product-parts-sync'
export {
  competitorCrawl,
  competitorCrawlCron,
} from './functions/competitor-crawl'
export {
  catalogImageMirror,
  catalogImageMirrorCron,
} from './functions/catalog-image-mirror'
export {
  imageSearchSweep,
  imageSearchSweepCron,
} from './functions/image-search-sweep'

// Re-export client for convenience
export { inngest } from './client'
