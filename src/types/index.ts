// ============================================================
// SHARED TYPE CONTRACTS — MedShip Prometheus
// All three workstreams (SF, Fishbowl, Orchestration) import from here.
// DO NOT MODIFY during parallel development.
// ============================================================

// --- Supabase Table Types ---

export interface SyncEvent {
  id: string;
  created_at: string;
  automation: AutomationType;
  source_system: SystemName;
  target_system: SystemName;
  source_record_id: string | null;
  target_record_id: string | null;
  status: SyncStatus;
  payload: Record<string, any> | null;
  response: Record<string, any> | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  next_retry_at: string | null;
  completed_at: string | null;
  idempotency_key: string | null;
}

export interface InventorySnapshot {
  id: string;
  part_number: string;
  part_description: string | null;
  qty_on_hand: number;
  qty_allocated: number;
  qty_available: number;
  uom: string;
  location: string | null;
  fishbowl_part_id: number | null;
  last_synced_at: string;
  sf_product_id: string | null;
}

export interface FieldMapping {
  id: string;
  automation: AutomationType;
  source_field: string;
  target_field: string;
  transform: string | null;
  is_required: boolean;
  default_value: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReorderRule {
  id: string;
  part_number: string;
  part_description: string | null;
  reorder_point: number;
  reorder_quantity: number;
  preferred_supplier: string | null;
  is_active: boolean;
  last_triggered_at: string | null;
  created_at: string;
}

export interface ConnectionConfig {
  id: string;
  system_name: SystemName;
  config: Record<string, any>;
  is_active: boolean;
  last_connected_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncSchedule {
  id: string;
  automation: AutomationType;
  cron_expression: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  last_run_status: string | null;
  last_run_duration_ms: number | null;
  records_processed: number;
}

// --- Enums ---

export type AutomationType =
  | 'P1_OPP_TO_SO'
  | 'P2_INVENTORY_SYNC'
  | 'P3_QB_INVOICE_SYNC'
  | 'P4_SHIPMENT_TRACKING'
  | 'P5_QUOTE_PDF'
  | 'P6_LOW_STOCK_CHECK';

export type SystemName = 'salesforce' | 'fishbowl' | 'quickbooks' | 'easypost' | 'internal';

export type SyncStatus = 'pending' | 'running' | 'success' | 'failed' | 'retrying' | 'dismissed';

// --- Salesforce Types (Instance A exports, Instance C consumes) ---

export interface SFOpportunity {
  Id: string;
  Name: string;
  AccountId: string;
  StageName: string;
  CloseDate: string;
  Amount: number;
  Fishbowl_SO_Number__c: string | null;
  Fulfillment_Status__c: string | null;
  Fulfillment_Error__c: string | null;
  Last_Sync_Attempt__c: string | null;
  Account: SFAccount;
  OpportunityLineItems?: { records: SFOpportunityLineItem[] };
}

export interface SFAccount {
  Id: string;
  Name: string;
  ShippingStreet: string | null;
  ShippingCity: string | null;
  ShippingState: string | null;
  ShippingPostalCode: string | null;
  ShippingCountry: string | null;
}

export interface SFOpportunityLineItem {
  Id: string;
  Product2: {
    Id: string;
    ProductCode: string;
    Name: string;
  };
  Quantity: number;
  UnitPrice: number;
  TotalPrice: number;
}

export interface SFProductUpdate {
  productCode: string;
  qtyOnHand: number;
  qtyAvailable: number;
}

export interface FulfillmentUpdate {
  fishbowlSONumber?: string;
  fulfillmentStatus: string;
  fulfillmentError?: string;
}

// --- Fishbowl Types (Instance B exports, Instance C consumes) ---

export interface FBInventoryItem {
  id: number;
  partNumber: string;
  partDescription?: string;
  quantity: string;  // Fishbowl returns quantity as string
  uom: {
    id: number;
    name: string;
    abbreviation: string;
  };
}

export interface FBSalesOrderPayload {
  customer: {
    name: string;
  };
  status?: string;
  shipTo: {
    name: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  items: FBSalesOrderItem[];
  notes?: string;
}

export interface FBSalesOrderItem {
  number: string;      // Part number (must match Fishbowl part)
  quantity: number;
  unitPrice: number;
  description?: string;
}

export interface FBSalesOrderResult {
  id: number;
  number: string;      // e.g., "SO-10045"
}

// --- Cross-Workstream Function Signatures ---
// These define what Instance C expects to import from A and B.
// Instance A and B MUST export functions matching these signatures.

export interface ISalesforceClient {
  connect(): Promise<void>;
  getConnection(): any;  // jsforce.Connection — typed as any to avoid dep in shared types
  isConnected(): boolean;
}

export interface IFishbowlClient {
  authenticate(): Promise<void>;
  request<T>(method: string, path: string, body?: any): Promise<T>;
  isAuthenticated(): boolean;
}

// --- Logger Types ---

export interface LogSyncEventInput {
  automation: AutomationType;
  sourceSystem: SystemName;
  targetSystem: SystemName;
  sourceRecordId?: string;
  targetRecordId?: string;
  status: SyncStatus;
  payload?: Record<string, any>;
  response?: Record<string, any>;
  errorMessage?: string;
  idempotencyKey?: string;
}

// --- Dashboard / UI Types ---

/** @deprecated Use AutomationType instead */
export type Automation = AutomationType;

export interface AutomationStats {
  automation: AutomationType;
  cronExpression: string;
  isActive: boolean;
  lastRunAt?: string;
  lastRunStatus?: string;
  lastRunDurationMs?: number;
  nextRunAt?: string;
  recordsProcessed: number;
  stats24h: {
    success: number;
    failed: number;
    pending: number;
    total: number;
    successRate: number;
  };
}

export const AUTOMATION_INFO: Record<
  AutomationType,
  { name: string; description: string; phase: number }
> = {
  P1_OPP_TO_SO: {
    name: 'Opportunity \u2192 Sales Order',
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
};

// --- Profile Call Types ---

export interface SFProfileCall {
  // Core Activity fields (exist on both Task and Event)
  Id: string;
  Subject: string;
  OwnerId: string;
  OwnerName: string;
  AccountId: string | null;
  AccountName: string | null;
  WhoId: string | null;              // Contact or Lead ID
  WhoName: string | null;
  ActivityDate: string;
  Status: string;
  CreatedDate: string;
  ActivityType: 'Task' | 'Event';    // Track which underlying object

  // Our custom Activity fields
  profileCallType: string | null;
  profileCallOutcome: string | null;
  productsDiscussed: string | null;   // Semicolon-separated (SF multi-select format)
  programSize: string | null;
  currentSupplier: string | null;
  budgetAvailable: number | null;
  budgetTimeframe: string | null;
  followUpDate: string | null;
  convertedToOpp: boolean;
  relatedOpportunityId: string | null;
  relatedOpportunityName: string | null;
  callNotesSummary: string | null;
  competitorIntel: string | null;

  // RingDNA metadata (read-only from integration)
  ringdnaDirection: string | null;
  ringdnaDurationMin: number | null;
  ringdnaConnected: boolean;
  ringdnaRating: number | null;
  ringdnaRecordingUrl: string | null;
  ringdnaVoicemail: boolean;
  ringdnaKeywords: string | null;
  ringdnaStartTime: string | null;
  ringdnaDisposition: string | null;

  // Calendly metadata (read-only from integration)
  calendlyNoShow: boolean;
  calendlyRescheduled: boolean;
}

export interface SFProfileCallMetrics {
  repId: string;
  repName: string;
  totalCalls: number;
  converted: number;
  conversionRate: number;
  connectedCalls: number;             // RingDNA: calls that actually reached the person
  connectRate: number;                // connectedCalls / totalCalls
  avgDuration: number;                // From RingDNA
  avgRating: number | null;           // From RingDNA
  callsThisWeek: number;
  callsThisMonth: number;
  topKeywords: string[];              // Most frequent RingDNA keywords
}

// --- API Response Types ---

export interface InventoryLookupResponse {
  partNumber: string;
  partDescription: string | null;
  qtyOnHand: number;
  qtyAvailable: number;
  uom: string;
  lastSyncedAt: string;
}

export interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  systems: {
    salesforce: { connected: boolean; lastCheck: string; error?: string };
    fishbowl: { connected: boolean; lastCheck: string; error?: string };
    quickbooks: { connected: boolean; lastCheck: string; error?: string };
    supabase: { connected: boolean; lastCheck: string; error?: string };
  };
  timestamp: string;
}
