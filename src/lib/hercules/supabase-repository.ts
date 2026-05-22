import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type {
  HerculesAdminPricingResult,
  HerculesCatalogItemRecord,
  HerculesImportJobCounters,
  HerculesImportJobRecord,
  HerculesImportJobStatus,
  HerculesImportRepository,
  HerculesOfferUomRecord,
  HerculesSupplierRecord,
  HerculesVendorOfferRecord,
  JsonObject,
  UpsertResult,
  ZeusEligibleSupplierCost,
} from './types'

type DbRow = Record<string, unknown>

function assertNoError(error: unknown) {
  if (error) {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : 'Unknown Supabase error'
    throw new Error(message)
  }
}

function isMissingRow(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'PGRST116'
  )
}

function rowId(row: DbRow | null) {
  return typeof row?.id === 'string' ? row.id : null
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toImportJob(row: DbRow): HerculesImportJobRecord {
  return {
    id: String(row.id),
    sourceSystem: String(row.source_system ?? 'hercules'),
    sourceMode: row.source_mode as HerculesImportJobRecord['sourceMode'],
    supplierCode: (row.supplier_code as string | null) ?? null,
    status: row.status as HerculesImportJobStatus,
    counters: {
      rowsSeen: Number(row.rows_seen ?? 0),
      rowsInserted: Number(row.rows_inserted ?? 0),
      rowsUpdated: Number(row.rows_updated ?? 0),
      rowsRejected: Number(row.rows_rejected ?? 0),
      numericContractPriceCount: Number(row.numeric_contract_price_count ?? 0),
      requestQuotePriceCount: Number(row.request_quote_price_count ?? 0),
      listOnlyPriceCount: Number(row.list_only_price_count ?? 0),
      missingUomCount: Number(row.missing_uom_count ?? 0),
      missingVendorPartNumberCount: Number(row.missing_vendor_part_number_count ?? 0),
    },
  }
}

function supplierPayload(input: Omit<HerculesSupplierRecord, 'id'>) {
  return {
    source_key: input.sourceKey,
    source_payload_hash: input.sourcePayloadHash,
    hercules_supplier_id: input.herculesSupplierId,
    supplier_code: input.supplierCode,
    supplier_name: input.supplierName,
    is_vendor: input.isVendor,
    is_manufacturer: input.isManufacturer,
    is_direct: input.isDirect,
    status: input.status,
    raw_payload: input.rawPayload,
    last_seen_import_job_id: input.lastSeenImportJobId,
    updated_at: new Date().toISOString(),
  }
}

function toSupplier(row: DbRow): HerculesSupplierRecord {
  return {
    id: String(row.id),
    sourceKey: String(row.source_key),
    sourcePayloadHash: String(row.source_payload_hash),
    herculesSupplierId: (row.hercules_supplier_id as string | null) ?? null,
    supplierCode: (row.supplier_code as string | null) ?? null,
    supplierName: String(row.supplier_name),
    isVendor: Boolean(row.is_vendor),
    isManufacturer: Boolean(row.is_manufacturer),
    isDirect: Boolean(row.is_direct),
    status: (row.status as string | null) ?? null,
    rawPayload: (row.raw_payload as JsonObject | null) ?? {},
    lastSeenImportJobId: String(row.last_seen_import_job_id),
  }
}

function catalogPayload(input: Omit<HerculesCatalogItemRecord, 'id'>) {
  return {
    source_key: input.sourceKey,
    source_payload_hash: input.sourcePayloadHash,
    hercules_item_id: input.herculesItemId,
    ms_id: input.msId,
    description: input.description,
    brand: input.brand,
    manufacturer_hercules_id: input.manufacturerHerculesId,
    manufacturer_name: input.manufacturerName,
    manufacturer_part_number: input.manufacturerPartNumber,
    category: input.category,
    subcategory: input.subcategory,
    unspsc: input.unspsc,
    country_of_origin: input.countryOfOrigin,
    status: input.status,
    image_urls_json: input.imageUrls,
    raw_payload: input.rawPayload,
    last_seen_import_job_id: input.lastSeenImportJobId,
    updated_at: new Date().toISOString(),
  }
}

function toCatalogItem(row: DbRow): HerculesCatalogItemRecord {
  return {
    id: String(row.id),
    sourceKey: String(row.source_key),
    sourcePayloadHash: String(row.source_payload_hash),
    herculesItemId: String(row.hercules_item_id),
    msId: (row.ms_id as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    brand: (row.brand as string | null) ?? null,
    manufacturerHerculesId: (row.manufacturer_hercules_id as string | null) ?? null,
    manufacturerName: (row.manufacturer_name as string | null) ?? null,
    manufacturerPartNumber: (row.manufacturer_part_number as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    subcategory: (row.subcategory as string | null) ?? null,
    unspsc: (row.unspsc as string | null) ?? null,
    countryOfOrigin: (row.country_of_origin as string | null) ?? null,
    status: (row.status as string | null) ?? null,
    imageUrls: Array.isArray(row.image_urls_json) ? (row.image_urls_json as string[]) : [],
    rawPayload: (row.raw_payload as JsonObject | null) ?? {},
    lastSeenImportJobId: String(row.last_seen_import_job_id),
  }
}

function vendorOfferPayload(input: Omit<HerculesVendorOfferRecord, 'id'>) {
  return {
    source_key: input.sourceKey,
    source_payload_hash: input.sourcePayloadHash,
    hercules_catalog_item_id: input.herculesCatalogItemId,
    hercules_item_id: input.herculesItemId,
    supplier_id: input.supplierId,
    supplier_code: input.supplierCode,
    vendor_name: input.vendorName,
    vendor_product_title: input.vendorProductTitle,
    is_primary: input.isPrimary,
    lead_time: input.leadTime,
    minimum_order_quantity: input.minimumOrderQuantity,
    raw_payload: input.rawPayload,
    last_seen_import_job_id: input.lastSeenImportJobId,
    updated_at: new Date().toISOString(),
  }
}

function toVendorOffer(row: DbRow): HerculesVendorOfferRecord {
  return {
    id: String(row.id),
    sourceKey: String(row.source_key),
    sourcePayloadHash: String(row.source_payload_hash),
    herculesCatalogItemId: String(row.hercules_catalog_item_id),
    herculesItemId: String(row.hercules_item_id),
    supplierId: String(row.supplier_id),
    supplierCode: (row.supplier_code as string | null) ?? null,
    vendorName: String(row.vendor_name),
    vendorProductTitle: String(row.vendor_product_title ?? ''),
    isPrimary: Boolean(row.is_primary),
    leadTime: (row.lead_time as string | null) ?? null,
    minimumOrderQuantity: toNumber(row.minimum_order_quantity),
    rawPayload: (row.raw_payload as JsonObject | null) ?? {},
    lastSeenImportJobId: String(row.last_seen_import_job_id),
  }
}

function offerUomPayload(input: Omit<HerculesOfferUomRecord, 'id'>) {
  return {
    source_key: input.sourceKey,
    source_payload_hash: input.sourcePayloadHash,
    hercules_vendor_offer_id: input.herculesVendorOfferId,
    uom_code: input.uomCode,
    vendor_part_number: input.vendorPartNumber,
    uom_title: input.uomTitle,
    package: input.package,
    per_quantity: input.perQuantity,
    list_price_amount: input.listPriceAmount,
    contract_price_amount: input.contractPriceAmount,
    contract_price_status: input.contractPriceStatus,
    raw_contract_price_text: input.rawContractPriceText,
    currency: input.currency,
    weight: input.weight,
    weight_unit: input.weightUnit,
    length: input.length,
    width: input.width,
    height: input.height,
    dimension_unit: input.dimensionUnit,
    gtin: input.gtin,
    hcpcs: input.hcpcs,
    volume: input.volume,
    availability: input.availability,
    is_cost_eligible: input.isCostEligible,
    cost_ineligibility_reason: input.costIneligibilityReason,
    raw_payload: input.rawPayload,
    last_seen_import_job_id: input.lastSeenImportJobId,
    updated_at: new Date().toISOString(),
  }
}

function toOfferUom(row: DbRow): HerculesOfferUomRecord {
  return {
    id: String(row.id),
    sourceKey: String(row.source_key),
    sourcePayloadHash: String(row.source_payload_hash),
    herculesVendorOfferId: String(row.hercules_vendor_offer_id),
    uomCode: (row.uom_code as string | null) ?? null,
    vendorPartNumber: (row.vendor_part_number as string | null) ?? null,
    uomTitle: (row.uom_title as string | null) ?? null,
    package: (row.package as string | null) ?? null,
    perQuantity: toNumber(row.per_quantity),
    listPriceAmount: toNumber(row.list_price_amount),
    contractPriceAmount: toNumber(row.contract_price_amount),
    contractPriceStatus: row.contract_price_status as HerculesOfferUomRecord['contractPriceStatus'],
    rawContractPriceText: (row.raw_contract_price_text as string | null) ?? null,
    currency: String(row.currency ?? 'USD'),
    weight: toNumber(row.weight),
    weightUnit: (row.weight_unit as string | null) ?? null,
    length: toNumber(row.length),
    width: toNumber(row.width),
    height: toNumber(row.height),
    dimensionUnit: (row.dimension_unit as string | null) ?? null,
    gtin: (row.gtin as string | null) ?? null,
    hcpcs: (row.hcpcs as string | null) ?? null,
    volume: (row.volume as string | null) ?? null,
    availability: (row.availability as string | null) ?? null,
    isCostEligible: Boolean(row.is_cost_eligible),
    costIneligibilityReason:
      (row.cost_ineligibility_reason as HerculesOfferUomRecord['costIneligibilityReason']) ??
      null,
    rawPayload: (row.raw_payload as JsonObject | null) ?? {},
    lastSeenImportJobId: String(row.last_seen_import_job_id),
  }
}

export class SupabaseHerculesPricingRepository implements HerculesImportRepository {
  private readonly supabase = createAdminClient()

  async createImportJob(input: {
    sourceMode: HerculesImportJobRecord['sourceMode']
    supplierCode: string | null
  }) {
    const { data, error } = await this.supabase
      .from('hercules_import_jobs')
      .insert({
        source_system: 'hercules',
        source_mode: input.sourceMode,
        supplier_code: input.supplierCode,
        status: 'running',
      })
      .select('*')
      .single()

    assertNoError(error)
    return toImportJob(data as DbRow)
  }

  async completeImportJob(
    id: string,
    input: {
      status: HerculesImportJobStatus
      counters: HerculesImportJobCounters
      errors: string[]
    }
  ) {
    const { error } = await this.supabase
      .from('hercules_import_jobs')
      .update({
        status: input.status,
        completed_at: new Date().toISOString(),
        rows_seen: input.counters.rowsSeen,
        rows_inserted: input.counters.rowsInserted,
        rows_updated: input.counters.rowsUpdated,
        rows_rejected: input.counters.rowsRejected,
        numeric_contract_price_count: input.counters.numericContractPriceCount,
        request_quote_price_count: input.counters.requestQuotePriceCount,
        list_only_price_count: input.counters.listOnlyPriceCount,
        missing_uom_count: input.counters.missingUomCount,
        missing_vendor_part_number_count: input.counters.missingVendorPartNumberCount,
        errors_json: input.errors.length > 0 ? input.errors : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)

    assertNoError(error)
  }

  async upsertSupplier(
    input: Omit<HerculesSupplierRecord, 'id'>
  ): Promise<UpsertResult<HerculesSupplierRecord>> {
    const existing = await this.findOne(
      'hercules_suppliers',
      'source_key',
      input.sourceKey
    )

    const { data, error } = await this.supabase
      .from('hercules_suppliers')
      .upsert(supplierPayload(input), {
        onConflict: 'source_key',
      })
      .select('*')
      .single()

    assertNoError(error)
    return { record: toSupplier(data as DbRow), created: !rowId(existing) }
  }

  async upsertCatalogItem(
    input: Omit<HerculesCatalogItemRecord, 'id'>
  ): Promise<UpsertResult<HerculesCatalogItemRecord>> {
    const existing = await this.findOne(
      'hercules_catalog_items',
      'source_key',
      input.sourceKey
    )
    const { data, error } = await this.supabase
      .from('hercules_catalog_items')
      .upsert(catalogPayload(input), { onConflict: 'source_key' })
      .select('*')
      .single()

    assertNoError(error)
    return { record: toCatalogItem(data as DbRow), created: !rowId(existing) }
  }

  async upsertVendorOffer(
    input: Omit<HerculesVendorOfferRecord, 'id'>
  ): Promise<UpsertResult<HerculesVendorOfferRecord>> {
    const existing = await this.findOne(
      'hercules_vendor_offers',
      'source_key',
      input.sourceKey
    )
    const { data, error } = await this.supabase
      .from('hercules_vendor_offers')
      .upsert(vendorOfferPayload(input), {
        onConflict: 'source_key',
      })
      .select('*')
      .single()

    assertNoError(error)
    return { record: toVendorOffer(data as DbRow), created: !rowId(existing) }
  }

  async upsertOfferUom(
    input: Omit<HerculesOfferUomRecord, 'id'>
  ): Promise<UpsertResult<HerculesOfferUomRecord>> {
    const existing = await this.findOne(
      'hercules_offer_uoms',
      'source_key',
      input.sourceKey
    )
    const { data, error } = await this.supabase
      .from('hercules_offer_uoms')
      .upsert(offerUomPayload(input), {
        onConflict: 'source_key',
      })
      .select('*')
      .single()

    assertNoError(error)
    return { record: toOfferUom(data as DbRow), created: !rowId(existing) }
  }

  async getEligibleSupplierCostsForZeusProduct(
    zeusProductId: string
  ): Promise<ZeusEligibleSupplierCost[]> {
    const { data, error } = await this.supabase
      .from('zeus_product_supplier_mappings')
      .select(
        `
        hercules_offer_uoms!inner(
          vendor_part_number,
          uom_code,
          package,
          per_quantity,
          contract_price_amount,
          contract_price_status,
          currency,
          is_cost_eligible,
          hercules_vendor_offers!inner(
            vendor_name,
            supplier_code,
            hercules_suppliers(supplier_name, supplier_code),
            hercules_catalog_items(manufacturer_name, manufacturer_part_number)
          )
        )
      `
      )
      .eq('zeus_product_id', zeusProductId)
      .eq('approval_status', 'approved')
      .eq('hercules_offer_uoms.is_cost_eligible', true)
      .eq('hercules_offer_uoms.contract_price_status', 'contract_available')
      .not('hercules_offer_uoms.contract_price_amount', 'is', null)

    assertNoError(error)

    return ((data ?? []) as DbRow[]).flatMap((mapping) => {
      const uom = mapping.hercules_offer_uoms as DbRow | null
      if (!uom || uom.contract_price_amount === null) return []

      const offer = uom.hercules_vendor_offers as DbRow | null
      const supplier = offer?.hercules_suppliers as DbRow | null
      const item = offer?.hercules_catalog_items as DbRow | null

      return [
        {
          supplierName: String(supplier?.supplier_name ?? offer?.vendor_name ?? ''),
          supplierCode:
            (supplier?.supplier_code as string | null) ??
            (offer?.supplier_code as string | null) ??
            null,
          manufacturerName: (item?.manufacturer_name as string | null) ?? null,
          manufacturerPartNumber:
            (item?.manufacturer_part_number as string | null) ?? null,
          vendorPartNumber: (uom.vendor_part_number as string | null) ?? null,
          uomCode: (uom.uom_code as string | null) ?? null,
          package: (uom.package as string | null) ?? null,
          perQuantity: toNumber(uom.per_quantity),
          contractPrice: Number(uom.contract_price_amount),
          currency: String(uom.currency ?? 'USD'),
          contractPriceStatus:
            uom.contract_price_status as ZeusEligibleSupplierCost['contractPriceStatus'],
          source: 'hercules',
        },
      ]
    })
  }

  async getAdminPricingForHerculesItem(
    herculesItemId: string
  ): Promise<HerculesAdminPricingResult> {
    const { data, error } = await this.supabase
      .from('hercules_catalog_items')
      .select(
        `
        hercules_item_id,
        hercules_vendor_offers(
          vendor_name,
          hercules_suppliers(supplier_name),
          hercules_offer_uoms(
            uom_code,
            vendor_part_number,
            list_price_amount,
            contract_price_amount,
            raw_contract_price_text,
            contract_price_status,
            is_cost_eligible,
            cost_ineligibility_reason
          )
        )
      `
      )
      .eq('hercules_item_id', herculesItemId)
      .maybeSingle()

    if (error && !isMissingRow(error)) assertNoError(error)

    const item = data as DbRow | null
    const offers = Array.isArray(item?.hercules_vendor_offers)
      ? (item.hercules_vendor_offers as DbRow[])
      : []
    const firstOffer = offers[0]
    const firstSupplier = firstOffer?.hercules_suppliers as DbRow | null

    return {
      herculesItemId,
      supplier:
        (firstSupplier?.supplier_name as string | null) ??
        (firstOffer?.vendor_name as string | null) ??
        null,
      uoms: offers.flatMap((offer) => {
        const uoms = Array.isArray(offer.hercules_offer_uoms)
          ? (offer.hercules_offer_uoms as DbRow[])
          : []

        return uoms.map((uom) => ({
          uomCode: (uom.uom_code as string | null) ?? null,
          vendorPartNumber: (uom.vendor_part_number as string | null) ?? null,
          listPrice: toNumber(uom.list_price_amount),
          contractPrice: toNumber(uom.contract_price_amount),
          rawContractPriceText: (uom.raw_contract_price_text as string | null) ?? null,
          contractPriceStatus:
            uom.contract_price_status as HerculesAdminPricingResult['uoms'][number]['contractPriceStatus'],
          isCostEligible: Boolean(uom.is_cost_eligible),
          costIneligibilityReason:
            (uom.cost_ineligibility_reason as HerculesAdminPricingResult['uoms'][number]['costIneligibilityReason']) ??
            null,
        }))
      }),
    }
  }

  private async findOne(table: string, column: string, value: string) {
    const { data, error } = await this.supabase
      .from(table)
      .select('id')
      .eq(column, value)
      .maybeSingle()

    if (error && !isMissingRow(error)) assertNoError(error)
    return data as DbRow | null
  }

}
