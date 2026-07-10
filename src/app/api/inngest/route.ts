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
  fishbowlSalesOrdersSync,
  fishbowlSalesOrdersSyncManual,
  fishbowlSalesOrdersBackfillPages,
  fishbowlSalesOrdersDetailHydrate,
  sfFullSync,
  sfIncrementalSync,
  herculesCatalogIngest,
  herculesCatalogDeltaCron,
  incentiveRecompute,
  incentiveRecomputeManual,
  incentivePayoutFreeze,
  incentiveWeeklyDigest,
  ceoDailyBriefing,
  purchaseOrdersSync,
  purchaseOrdersSyncManual,
  shipmentsCacheSync,
  shipmentsCacheSyncManual,
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

    // P7: Fishbowl Sales Orders -> canonical quote/order cache
    fishbowlSalesOrdersSync,
    fishbowlSalesOrdersSyncManual,
    fishbowlSalesOrdersBackfillPages,
    fishbowlSalesOrdersDetailHydrate,

    // SF → Supabase cache sync
    sfFullSync,
    sfIncrementalSync,

    // P10: Hercules supplier catalog ingestion
    herculesCatalogIngest,
    herculesCatalogDeltaCron,
    // P8: Q3 incentive classification recompute + new-account bell
    incentiveRecompute,
    incentiveRecomputeManual,
    incentivePayoutFreeze,
    incentiveWeeklyDigest,
    ceoDailyBriefing,

    // P11: Fishbowl Purchase Orders -> Supabase (wallboard + future purchasing)
    purchaseOrdersSync,
    purchaseOrdersSyncManual,

    // P12: Recent shipments cache (wallboard Shipped lane)
    shipmentsCacheSync,
    shipmentsCacheSyncManual,
  ],
})
