// Shared type definitions

export type SyncStatus = 'pending' | 'success' | 'failed' | 'retrying'

export type Automation =
  | 'P1_OPP_TO_SO'
  | 'P2_INVENTORY_SYNC'
  | 'P3_QB_INVOICE_SYNC'
  | 'P4_SHIPMENT_TRACKING'
  | 'P5_QUOTE_PDF'
  | 'P6_LOW_STOCK_CHECK'

export type SystemName = 'salesforce' | 'fishbowl' | 'quickbooks' | 'easypost' | 'prometheus'

export interface SyncEvent {
  id: string
  createdAt: string
  automation: Automation
  sourceSystem: SystemName
  targetSystem: SystemName
  sourceRecordId?: string
  targetRecordId?: string
  status: SyncStatus
  payload?: Record<string, unknown>
  response?: Record<string, unknown>
  errorMessage?: string
  retryCount: number
  maxRetries: number
  nextRetryAt?: string
  completedAt?: string
  idempotencyKey?: string
}

export interface SyncSchedule {
  id: string
  automation: Automation
  cronExpression: string
  isActive: boolean
  lastRunAt?: string
  nextRunAt?: string
  lastRunStatus?: string
  lastRunDurationMs?: number
  recordsProcessed: number
}

export interface AutomationStats {
  automation: Automation
  cronExpression: string
  isActive: boolean
  lastRunAt?: string
  lastRunStatus?: string
  lastRunDurationMs?: number
  nextRunAt?: string
  recordsProcessed: number
  stats24h: {
    success: number
    failed: number
    pending: number
    total: number
    successRate: number
  }
}

export interface InventoryItem {
  partNumber: string
  partDescription?: string
  qtyOnHand: number
  qtyAllocated: number
  qtyAvailable: number
  uom: string
  location?: string
  lastSyncedAt: string
}

export interface FieldMapping {
  id: string
  automation: string
  sourceField: string
  targetField: string
  transform?: string
  isRequired: boolean
  defaultValue?: string
  notes?: string
}

export interface ConnectionConfig {
  id: string
  systemName: SystemName
  isActive: boolean
  lastConnectedAt?: string
  lastError?: string
}

export interface ReorderRule {
  id: string
  partNumber: string
  partDescription?: string
  reorderPoint: number
  reorderQuantity: number
  preferredSupplier?: string
  isActive: boolean
  lastTriggeredAt?: string
}

// Automation display info
export const AUTOMATION_INFO: Record<
  Automation,
  { name: string; description: string; phase: number }
> = {
  P1_OPP_TO_SO: {
    name: 'Opportunity → Sales Order',
    description: 'Creates Fishbowl SO when SF Opportunity closes',
    phase: 1,
  },
  P2_INVENTORY_SYNC: {
    name: 'Inventory Sync',
    description: 'Syncs Fishbowl inventory to Salesforce Products',
    phase: 2,
  },
  P3_QB_INVOICE_SYNC: {
    name: 'Invoice Sync',
    description: 'Syncs QuickBooks invoices/payments to Salesforce',
    phase: 3,
  },
  P4_SHIPMENT_TRACKING: {
    name: 'Shipment Tracking',
    description: 'Syncs Fishbowl shipments to SF tracking fields',
    phase: 4,
  },
  P5_QUOTE_PDF: {
    name: 'Quote PDF',
    description: 'Generates quote PDFs with real-time inventory',
    phase: 5,
  },
  P6_LOW_STOCK_CHECK: {
    name: 'Low Stock Alerts',
    description: 'Checks inventory against reorder points',
    phase: 6,
  },
}
