import type {
  HerculesAdminPricingResult,
  HerculesApiSyncStateInput,
  HerculesApiSyncStateRecord,
  HerculesCatalogItemRecord,
  HerculesImportJobCounters,
  HerculesImportJobRecord,
  HerculesImportJobStatus,
  HerculesImportRepository,
  HerculesIngestionCheckpoint,
  HerculesIngestionReject,
  HerculesIngestionRepository,
  HerculesIngestionResource,
  HerculesIngestionRunRecord,
  HerculesIngestionRunStatus,
  HerculesIngestionRunType,
  HerculesOfferUomRecord,
  HerculesSupplierRecord,
  HerculesVendorOfferRecord,
  UpsertResult,
  ZeusEligibleSupplierCost,
} from './types'

let idSequence = 0

function nextId(prefix: string) {
  idSequence += 1
  return `${prefix}-${idSequence}`
}

const zeroCounters = (): HerculesImportJobCounters => ({
  rowsSeen: 0,
  rowsInserted: 0,
  rowsUpdated: 0,
  rowsRejected: 0,
  numericContractPriceCount: 0,
  requestQuotePriceCount: 0,
  listOnlyPriceCount: 0,
  missingUomCount: 0,
  missingVendorPartNumberCount: 0,
})

type MappingRecord = {
  zeusProductId: string
  herculesOfferUomId: string
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'needs_review'
}

export class InMemoryHerculesImportRepository implements HerculesImportRepository {
  readonly importJobs = new Map<string, HerculesImportJobRecord>()
  readonly suppliers = new Map<string, HerculesSupplierRecord>()
  readonly catalogItems = new Map<string, HerculesCatalogItemRecord>()
  readonly vendorOffers = new Map<string, HerculesVendorOfferRecord>()
  readonly offerUoms = new Map<string, HerculesOfferUomRecord>()
  readonly apiSyncStates = new Map<string, HerculesApiSyncStateRecord>()
  readonly mappings: MappingRecord[] = []

  async createImportJob(input: {
    sourceMode: HerculesImportJobRecord['sourceMode']
    supplierCode: string | null
  }) {
    const job: HerculesImportJobRecord = {
      id: nextId('job'),
      sourceSystem: 'hercules',
      sourceMode: input.sourceMode,
      supplierCode: input.supplierCode,
      status: 'running',
      counters: zeroCounters(),
    }
    this.importJobs.set(job.id, job)
    return job
  }

  async completeImportJob(
    id: string,
    input: {
      status: HerculesImportJobStatus
      counters: HerculesImportJobCounters
      errors: string[]
    }
  ) {
    const job = this.importJobs.get(id)
    if (!job) throw new Error(`Import job not found: ${id}`)
    this.importJobs.set(id, {
      ...job,
      status: input.status,
      counters: input.counters,
    })
  }

  async upsertSupplier(
    input: Omit<HerculesSupplierRecord, 'id'>
  ): Promise<UpsertResult<HerculesSupplierRecord>> {
    const existing = [...this.suppliers.values()].find(
      (supplier) => supplier.sourceKey === input.sourceKey
    )

    if (existing) {
      const record = { ...existing, ...input }
      this.suppliers.set(record.id, record)
      return { record, created: false }
    }

    const record = { id: nextId('supplier'), ...input }
    this.suppliers.set(record.id, record)
    return { record, created: true }
  }

  async upsertCatalogItem(
    input: Omit<HerculesCatalogItemRecord, 'id'>
  ): Promise<UpsertResult<HerculesCatalogItemRecord>> {
    const existing = [...this.catalogItems.values()].find(
      (item) => item.sourceKey === input.sourceKey
    )

    if (existing) {
      const record = { ...existing, ...input }
      this.catalogItems.set(record.id, record)
      return { record, created: false }
    }

    const record = { id: nextId('catalog'), ...input }
    this.catalogItems.set(record.id, record)
    return { record, created: true }
  }

  async upsertVendorOffer(
    input: Omit<HerculesVendorOfferRecord, 'id'>
  ): Promise<UpsertResult<HerculesVendorOfferRecord>> {
    const existing = [...this.vendorOffers.values()].find(
      (offer) => offer.sourceKey === input.sourceKey
    )

    if (existing) {
      const record = { ...existing, ...input }
      this.vendorOffers.set(record.id, record)
      return { record, created: false }
    }

    const record = { id: nextId('offer'), ...input }
    this.vendorOffers.set(record.id, record)
    return { record, created: true }
  }

  async upsertOfferUom(
    input: Omit<HerculesOfferUomRecord, 'id'>
  ): Promise<UpsertResult<HerculesOfferUomRecord>> {
    const existing = [...this.offerUoms.values()].find(
      (uom) => uom.sourceKey === input.sourceKey
    )

    if (existing) {
      const record = { ...existing, ...input }
      this.offerUoms.set(record.id, record)
      return { record, created: false }
    }

    const record = { id: nextId('uom'), ...input }
    this.offerUoms.set(record.id, record)
    return { record, created: true }
  }

  async getApiSyncState(sourceKey: string) {
    return this.apiSyncStates.get(sourceKey) ?? null
  }

  async upsertApiSyncState(input: HerculesApiSyncStateInput) {
    const existing = this.apiSyncStates.get(input.sourceKey)
    const record: HerculesApiSyncStateRecord = {
      id: existing?.id ?? nextId('api-sync-state'),
      ...input,
    }
    this.apiSyncStates.set(record.sourceKey, record)
    return record
  }

  approveMapping(input: { zeusProductId: string; herculesOfferUomId: string }) {
    this.mappings.push({
      zeusProductId: input.zeusProductId,
      herculesOfferUomId: input.herculesOfferUomId,
      approvalStatus: 'approved',
    })
  }

  getEligibleSupplierCostsForZeusProduct(zeusProductId: string): ZeusEligibleSupplierCost[] {
    return this.mappings
      .filter(
        (mapping) =>
          mapping.zeusProductId === zeusProductId &&
          mapping.approvalStatus === 'approved'
      )
      .flatMap((mapping) => {
        const uom = this.offerUoms.get(mapping.herculesOfferUomId)
        if (
          !uom?.isCostEligible ||
          uom.contractPriceAmount === null ||
          uom.contractPriceStatus !== 'contract_available'
        ) {
          return []
        }

        const offer = this.vendorOffers.get(uom.herculesVendorOfferId)
        if (!offer) return []
        const supplier = this.suppliers.get(offer.supplierId)
        const item = this.catalogItems.get(offer.herculesCatalogItemId)

        return [
          {
            supplierName: supplier?.supplierName ?? offer.vendorName,
            supplierCode: supplier?.supplierCode ?? offer.supplierCode,
            manufacturerName: item?.manufacturerName ?? null,
            manufacturerPartNumber: item?.manufacturerPartNumber ?? null,
            vendorPartNumber: uom.vendorPartNumber,
            uomCode: uom.uomCode,
            package: uom.package,
            perQuantity: uom.perQuantity,
            contractPrice: uom.contractPriceAmount,
            currency: uom.currency,
            contractPriceStatus: uom.contractPriceStatus,
            source: 'hercules',
          },
        ]
      })
  }

  getImportJob(id: string) {
    return this.importJobs.get(id) ?? null
  }

  getAdminPricingForHerculesItem(herculesItemId: string): HerculesAdminPricingResult {
    const item = [...this.catalogItems.values()].find(
      (candidate) => candidate.herculesItemId === herculesItemId
    )
    if (!item) {
      return {
        herculesItemId,
        supplier: null,
        uoms: [],
      }
    }

    const offers = [...this.vendorOffers.values()].filter(
      (offer) => offer.herculesCatalogItemId === item.id
    )
    const firstSupplier = offers[0]
      ? this.suppliers.get(offers[0].supplierId)?.supplierName ?? offers[0].vendorName
      : null

    return {
      herculesItemId,
      supplier: firstSupplier,
      uoms: offers.flatMap((offer) =>
        [...this.offerUoms.values()]
          .filter((uom) => uom.herculesVendorOfferId === offer.id)
          .map((uom) => ({
            uomCode: uom.uomCode,
            vendorPartNumber: uom.vendorPartNumber,
            listPrice: uom.listPriceAmount,
            contractPrice: uom.contractPriceAmount,
            rawContractPriceText: uom.rawContractPriceText,
            contractPriceStatus: uom.contractPriceStatus,
            isCostEligible: uom.isCostEligible,
            costIneligibilityReason: uom.costIneligibilityReason,
          }))
      ),
    }
  }
}

export class InMemoryHerculesIngestionRepository implements HerculesIngestionRepository {
  readonly runs = new Map<string, HerculesIngestionRunRecord>()
  readonly rejects: HerculesIngestionReject[] = []
  readonly watermarks = new Map<
    HerculesIngestionResource,
    { watermark: string; lastCompletedRunId: string }
  >()

  async createRun(input: {
    resource: HerculesIngestionResource
    runType: HerculesIngestionRunType
    pageSize: number
    updatedSince: string | null
    importJobId: string | null
    triggeredBy: string | null
  }) {
    const run: HerculesIngestionRunRecord = {
      id: nextId('run'),
      resource: input.resource,
      runType: input.runType,
      status: 'running',
      pageSize: input.pageSize,
      nextOffset: 0,
      pagesFetched: 0,
      totalRemote: null,
      itemsSeen: 0,
      itemsInserted: 0,
      itemsUpdated: 0,
      itemsRejected: 0,
      counters: zeroCounters(),
      updatedSince: input.updatedSince,
      maxSourceUpdatedAt: null,
      importJobId: input.importJobId,
      lastError: null,
      rateLimitSnapshot: null,
      triggeredBy: input.triggeredBy,
      startedAt: new Date().toISOString(),
      completedAt: null,
    }
    this.runs.set(run.id, run)
    return run
  }

  async getRun(id: string) {
    return this.runs.get(id) ?? null
  }

  async getActiveRun(resource: HerculesIngestionResource) {
    return (
      [...this.runs.values()].find(
        (run) => run.resource === resource && run.status === 'running'
      ) ?? null
    )
  }

  async checkpointRun(id: string, checkpoint: HerculesIngestionCheckpoint) {
    const run = this.runs.get(id)
    if (!run) throw new Error(`Ingestion run not found: ${id}`)
    this.runs.set(id, {
      ...run,
      nextOffset: checkpoint.nextOffset,
      pagesFetched: checkpoint.pagesFetched,
      totalRemote: checkpoint.totalRemote,
      itemsSeen: checkpoint.counters.rowsSeen,
      itemsInserted: checkpoint.counters.rowsInserted,
      itemsUpdated: checkpoint.counters.rowsUpdated,
      itemsRejected: checkpoint.counters.rowsRejected,
      counters: { ...checkpoint.counters },
      maxSourceUpdatedAt: checkpoint.maxSourceUpdatedAt,
      rateLimitSnapshot: checkpoint.rateLimitSnapshot,
    })
  }

  async completeRun(
    id: string,
    input: {
      status: Exclude<HerculesIngestionRunStatus, 'running'>
      lastError?: string | null
    }
  ) {
    const run = this.runs.get(id)
    if (!run) throw new Error(`Ingestion run not found: ${id}`)
    this.runs.set(id, {
      ...run,
      status: input.status,
      lastError: input.lastError ?? null,
      completedAt: new Date().toISOString(),
    })
  }

  async recordReject(reject: HerculesIngestionReject) {
    this.rejects.push(reject)
  }

  async getSyncWatermark(resource: HerculesIngestionResource) {
    return this.watermarks.get(resource)?.watermark ?? null
  }

  async setSyncWatermark(
    resource: HerculesIngestionResource,
    watermark: string,
    lastCompletedRunId: string
  ) {
    this.watermarks.set(resource, { watermark, lastCompletedRunId })
  }
}
