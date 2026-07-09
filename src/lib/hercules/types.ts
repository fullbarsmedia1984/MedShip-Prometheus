export type JsonObject = Record<string, unknown>

export type HerculesContractPriceStatus =
  | 'contract_available'
  | 'list_only_request_quote'
  | 'list_only'
  | 'not_provided'
  | 'unavailable'
  | 'expired'
  | 'parse_error'
  | 'unknown'

export type HerculesCostIneligibilityReason =
  | 'contract_price_requires_quote'
  | 'contract_price_list_only'
  | 'contract_price_not_provided'
  | 'contract_price_parse_error'
  | 'supplier_inactive'
  | 'item_inactive'
  | 'missing_uom'
  | 'missing_vendor_part_number'
  | 'uom_conversion_untrusted'
  | 'unknown'

export type HerculesImportSourceMode =
  | 'fixture'
  | 'api'
  | 'csv'
  | 'json'
  | 'direct_db'
  | 'webhook'

export type HerculesImportJobStatus =
  | 'success'
  | 'failed'
  | 'partial'
  | 'running'

export type HerculesManufacturerPayload = {
  id: string | null
  name: string | null
  partNumber: string | null
}

export type HerculesOfferUomPayload = {
  uomCode: string | null
  vendorPartNumber: string | null
  uomTitle: string | null
  listPrice: string | number | null
  contractPrice: string | number | null
  contractPriceStatus?: HerculesContractPriceStatus | null
  package: string | null
  perQuantity: number | string | null
  rawPerText?: string | null
  parsedPerQuantity?: number | string | null
  parsedPerUom?: string | null
  isDefault?: boolean | null
  quantityAvailable?: number | string | null
  weight?: number | string | null
  weightUnit?: string | null
  length?: number | string | null
  width?: number | string | null
  height?: number | string | null
  dimensionUnit?: string | null
  gtin?: string | null
  hcpcs?: string | null
  volume?: string | null
  volumeUom?: string | null
  availability?: string | null
  rawPayload?: JsonObject
}

export type HerculesVendorOfferPayload = {
  vendorName: string
  supplierCode: string | null
  supplierId: string | null
  isPrimary: boolean
  vendorProductTitle: string | null
  leadTime: string | null
  minimumOrderQuantity: number | string | null
  uoms: HerculesOfferUomPayload[]
  rawPayload?: JsonObject
}

export type HerculesSupplierItemPayload = {
  supplierItemId: string
  msId: string | null
  description: string | null
  manufacturer: HerculesManufacturerPayload
  category: string | null
  subcategory: string | null
  brand: string | null
  countryOfOrigin: string | null
  unspsc: string | null
  status: string | null
  images: string[]
  vendorOffers: HerculesVendorOfferPayload[]
  rawPayload?: JsonObject
}

export type HerculesPricingSource = {
  mode: HerculesImportSourceMode
  supplierCode?: string
  getSupplierItems(): AsyncIterable<HerculesSupplierItemPayload>
}

export type PriceParseResult = {
  amount: number | null
  status: HerculesContractPriceStatus
  rawText: string | null
}

export type HerculesImportJobCounters = {
  rowsSeen: number
  rowsInserted: number
  rowsUpdated: number
  rowsRejected: number
  numericContractPriceCount: number
  requestQuotePriceCount: number
  listOnlyPriceCount: number
  missingUomCount: number
  missingVendorPartNumberCount: number
}

export type HerculesImportJobRecord = {
  id: string
  sourceSystem: string
  sourceMode: HerculesImportSourceMode
  supplierCode: string | null
  status: HerculesImportJobStatus
  counters: HerculesImportJobCounters
}

export type HerculesSupplierRecord = {
  id: string
  sourceKey: string
  sourcePayloadHash: string
  herculesSupplierId: string | null
  supplierCode: string | null
  supplierName: string
  isVendor: boolean
  isManufacturer: boolean
  isDirect: boolean
  status: string | null
  rawPayload: JsonObject
  lastSeenImportJobId: string
}

export type HerculesCatalogItemRecord = {
  id: string
  sourceKey: string
  sourcePayloadHash: string
  herculesItemId: string
  msId: string | null
  description: string | null
  brand: string | null
  manufacturerHerculesId: string | null
  manufacturerName: string | null
  manufacturerPartNumber: string | null
  category: string | null
  subcategory: string | null
  unspsc: string | null
  countryOfOrigin: string | null
  status: string | null
  imageUrls: string[]
  rawPayload: JsonObject
  lastSeenImportJobId: string
}

export type HerculesVendorOfferRecord = {
  id: string
  sourceKey: string
  sourcePayloadHash: string
  herculesCatalogItemId: string
  herculesItemId: string
  supplierId: string
  supplierCode: string | null
  vendorName: string
  vendorProductTitle: string
  isPrimary: boolean
  leadTime: string | null
  minimumOrderQuantity: number | null
  rawPayload: JsonObject
  lastSeenImportJobId: string
}

export type HerculesOfferUomRecord = {
  id: string
  sourceKey: string
  sourcePayloadHash: string
  herculesVendorOfferId: string
  uomCode: string | null
  vendorPartNumber: string | null
  uomTitle: string | null
  package: string | null
  perQuantity: number | null
  rawPerText: string | null
  parsedPerQuantity: number | null
  parsedPerUom: string | null
  listPriceAmount: number | null
  contractPriceAmount: number | null
  contractPriceStatus: HerculesContractPriceStatus
  rawContractPriceText: string | null
  currency: string
  weight: number | null
  weightUnit: string | null
  length: number | null
  width: number | null
  height: number | null
  dimensionUnit: string | null
  gtin: string | null
  hcpcs: string | null
  volume: string | null
  volumeUom: string | null
  isDefault: boolean | null
  quantityAvailable: number | null
  availability: string | null
  isCostEligible: boolean
  costIneligibilityReason: HerculesCostIneligibilityReason | null
  rawPayload: JsonObject
  lastSeenImportJobId: string
}

export type UpsertResult<T> = {
  record: T
  created: boolean
}

export type HerculesIngestionResource = 'parts' | 'suppliers' | 'products'

export type HerculesIngestionRunType = 'full' | 'delta'

export type HerculesIngestionRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export type HerculesIngestionRunRecord = {
  id: string
  resource: HerculesIngestionResource
  runType: HerculesIngestionRunType
  status: HerculesIngestionRunStatus
  pageSize: number
  nextOffset: number
  pagesFetched: number
  totalRemote: number | null
  itemsSeen: number
  itemsInserted: number
  itemsUpdated: number
  itemsRejected: number
  counters: HerculesImportJobCounters
  updatedSince: string | null
  maxSourceUpdatedAt: string | null
  importJobId: string | null
  lastError: string | null
  rateLimitSnapshot: JsonObject | null
  triggeredBy: string | null
  startedAt: string
  completedAt: string | null
}

export type HerculesIngestionCheckpoint = {
  nextOffset: number
  pagesFetched: number
  totalRemote: number | null
  counters: HerculesImportJobCounters
  maxSourceUpdatedAt: string | null
  rateLimitSnapshot: JsonObject | null
}

export type HerculesIngestionReject = {
  runId: string
  pageOffset: number
  recordIndex: number
  herculesItemId: string | null
  errorMessage: string
  rawPayload: JsonObject
}

export type HerculesIngestionRepository = {
  createRun(input: {
    resource: HerculesIngestionResource
    runType: HerculesIngestionRunType
    pageSize: number
    updatedSince: string | null
    importJobId: string | null
    triggeredBy: string | null
  }): Promise<HerculesIngestionRunRecord>
  getRun(id: string): Promise<HerculesIngestionRunRecord | null>
  getActiveRun(resource: HerculesIngestionResource): Promise<HerculesIngestionRunRecord | null>
  checkpointRun(id: string, checkpoint: HerculesIngestionCheckpoint): Promise<void>
  completeRun(
    id: string,
    input: {
      status: Exclude<HerculesIngestionRunStatus, 'running'>
      lastError?: string | null
    }
  ): Promise<void>
  recordReject(reject: HerculesIngestionReject): Promise<void>
  getSyncWatermark(resource: HerculesIngestionResource): Promise<string | null>
  setSyncWatermark(
    resource: HerculesIngestionResource,
    watermark: string,
    lastCompletedRunId: string
  ): Promise<void>
}

export type HerculesImportRepository = {
  createImportJob(input: {
    sourceMode: HerculesImportSourceMode
    supplierCode: string | null
  }): Promise<HerculesImportJobRecord>
  completeImportJob(
    id: string,
    input: {
      status: HerculesImportJobStatus
      counters: HerculesImportJobCounters
      errors: string[]
    }
  ): Promise<void>
  upsertSupplier(
    input: Omit<HerculesSupplierRecord, 'id'>
  ): Promise<UpsertResult<HerculesSupplierRecord>>
  upsertCatalogItem(
    input: Omit<HerculesCatalogItemRecord, 'id'>
  ): Promise<UpsertResult<HerculesCatalogItemRecord>>
  upsertVendorOffer(
    input: Omit<HerculesVendorOfferRecord, 'id'>
  ): Promise<UpsertResult<HerculesVendorOfferRecord>>
  upsertOfferUom(
    input: Omit<HerculesOfferUomRecord, 'id'>
  ): Promise<UpsertResult<HerculesOfferUomRecord>>
}

export type HerculesApiSyncPhase = 'full_backfill' | 'delta'

export type HerculesApiSyncStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'failed'
  | 'partial'

export type HerculesApiSyncStateRecord = {
  id: string
  sourceKey: string
  supplierCode: string | null
  phase: HerculesApiSyncPhase
  status: HerculesApiSyncStatus
  pageLimit: number
  nextOffset: number | null
  backfillStartedAt: string | null
  backfillCompletedAt: string | null
  deltaCursor: string | null
  lastProcessedUpdatedAt: string | null
  lastImportJobId: string | null
  lastError: string | null
  metadata: JsonObject
}

export type HerculesApiSyncStateInput = Omit<HerculesApiSyncStateRecord, 'id'>

export type HerculesApiSyncStateRepository = {
  getApiSyncState(sourceKey: string): Promise<HerculesApiSyncStateRecord | null>
  upsertApiSyncState(
    input: HerculesApiSyncStateInput
  ): Promise<HerculesApiSyncStateRecord>
}

export type ZeusEligibleSupplierCost = {
  supplierName: string
  supplierCode: string | null
  manufacturerName: string | null
  manufacturerPartNumber: string | null
  vendorPartNumber: string | null
  uomCode: string | null
  package: string | null
  perQuantity: number | null
  contractPrice: number
  currency: string
  contractPriceStatus: HerculesContractPriceStatus
  source: 'hercules'
}

export type HerculesAdminPricingRow = {
  uomCode: string | null
  vendorPartNumber: string | null
  listPrice: number | null
  contractPrice: number | null
  rawContractPriceText: string | null
  contractPriceStatus: HerculesContractPriceStatus
  isCostEligible: boolean
  costIneligibilityReason: HerculesCostIneligibilityReason | null
}

export type HerculesAdminPricingResult = {
  herculesItemId: string
  supplier: string | null
  uoms: HerculesAdminPricingRow[]
}
