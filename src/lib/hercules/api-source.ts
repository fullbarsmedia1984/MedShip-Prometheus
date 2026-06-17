import {
  HerculesApiClient,
  HerculesRateLimitExceededError,
  type HerculesApiRequestBody,
} from './api-client'
import { parseMoneyAmount } from './price-parser'
import { parsePerText } from './per-parser'
import type {
  HerculesContractPriceStatus,
  HerculesPricingSource,
  HerculesSupplierItemPayload,
  JsonObject,
} from './types'

type HerculesApiPartUnit = JsonObject & {
  unit?: unknown
  vendorPartNumber?: unknown
  uomTitle?: unknown
  cost?: unknown
  per?: unknown
  gtin?: unknown
  hcpcsCode?: unknown
  volume?: unknown
  volumeUOM?: unknown
  packagingType?: unknown
  availability?: unknown
  weight?: unknown
  weightUOM?: unknown
  length?: unknown
  width?: unknown
  height?: unknown
  sizeUOM?: unknown
  isDefault?: unknown
  quantityAvailable?: unknown
}

type HerculesApiPartVendor = JsonObject & {
  _id?: unknown
  supplierId?: unknown
  vendorId?: unknown
  vendorName?: unknown
  supplierCode?: unknown
  title?: unknown
  isPrimary?: unknown
  leadTime?: unknown
  minimumOrderQuantity?: unknown
  units?: unknown
}

export type HerculesApiPart = JsonObject & {
  _id?: unknown
  msId?: unknown
  description?: unknown
  manufacturerName?: unknown
  manufacturerId?: unknown
  manufacturerPartNumber?: unknown
  title?: unknown
  brand?: unknown
  category?: unknown
  subCategory?: unknown
  subcategory?: unknown
  countryOfOrigin?: unknown
  unspsc?: unknown
  isActive?: unknown
  imageUrl?: unknown
  images?: unknown
  vendors?: unknown
}

export type ApiHerculesPricingSourceOptions = {
  client: HerculesApiClient
  pageSize?: number
  updatedSince?: string
  costIsConfirmedContractCost?: boolean
  lowRateLimitRemainingThreshold?: number
  maxRateLimitRetries?: number
  rateLimitFallbackDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_PAGE_SIZE = 100

function textOrNull(value: unknown) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text || null
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function booleanOrFalse(value: unknown) {
  return value === true
}

function booleanOrNull(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function arrayOrEmpty(value: unknown) {
  return Array.isArray(value) ? value : []
}

function resetDelayMs(reset: string | null, fallbackDelayMs: number) {
  if (!reset) return fallbackDelayMs
  const resetMs = Date.parse(reset)
  if (!Number.isFinite(resetMs)) return fallbackDelayMs
  return Math.max(0, resetMs - Date.now())
}

function contractStatusForApiCost(
  cost: unknown,
  costIsConfirmedContractCost: boolean
): HerculesContractPriceStatus {
  if (parseMoneyAmount(cost as string | number | null) === null) return 'not_provided'
  return costIsConfirmedContractCost ? 'contract_available' : 'unknown'
}

export function normalizeHerculesApiPart(
  part: HerculesApiPart,
  options: {
    costIsConfirmedContractCost: boolean
  }
): HerculesSupplierItemPayload | null {
  const supplierItemId = textOrNull(part._id) ?? textOrNull(part.msId)
  if (!supplierItemId) return null

  const images = Array.isArray(part.images)
    ? part.images.map(textOrNull).filter((value): value is string => value !== null)
    : textOrNull(part.imageUrl)
      ? [textOrNull(part.imageUrl) as string]
      : []

  return {
    supplierItemId,
    msId: textOrNull(part.msId),
    description: textOrNull(part.description),
    manufacturer: {
      id: textOrNull(part.manufacturerId),
      name: textOrNull(part.manufacturerName),
      partNumber: textOrNull(part.manufacturerPartNumber),
    },
    category: textOrNull(part.category),
    subcategory: textOrNull(part.subCategory) ?? textOrNull(part.subcategory),
    brand: textOrNull(part.brand) ?? textOrNull(part.title),
    countryOfOrigin: textOrNull(part.countryOfOrigin),
    unspsc: textOrNull(part.unspsc),
    status: part.isActive === false ? 'inactive' : 'active',
    images,
    rawPayload: part,
    vendorOffers: arrayOrEmpty(part.vendors)
      .filter((vendor): vendor is HerculesApiPartVendor => Boolean(textOrNull((vendor as HerculesApiPartVendor).vendorName)))
      .map((vendor) => ({
        vendorName: textOrNull(vendor.vendorName) as string,
        supplierCode: textOrNull(vendor.supplierCode),
        supplierId:
          textOrNull(vendor.supplierId) ??
          textOrNull(vendor.vendorId) ??
          textOrNull(vendor._id),
        isPrimary: booleanOrFalse(vendor.isPrimary),
        vendorProductTitle: textOrNull(vendor.title),
        leadTime: textOrNull(vendor.leadTime),
        minimumOrderQuantity: numberOrNull(vendor.minimumOrderQuantity),
        rawPayload: vendor,
        uoms: arrayOrEmpty(vendor.units).map((unitValue) => {
          const unit = unitValue as HerculesApiPartUnit
          const parsedPer = parsePerText(unit.per)
          const cost = parseMoneyAmount(unit.cost as string | number | null)

          return {
            uomCode: textOrNull(unit.unit),
            vendorPartNumber: textOrNull(unit.vendorPartNumber),
            uomTitle: textOrNull(unit.uomTitle),
            listPrice: null,
            contractPrice: cost,
            contractPriceStatus: contractStatusForApiCost(
              unit.cost,
              options.costIsConfirmedContractCost
            ),
            package: textOrNull(unit.packagingType),
            perQuantity: parsedPer.parsedPerQuantity,
            rawPerText: parsedPer.rawPerText,
            parsedPerQuantity: parsedPer.parsedPerQuantity,
            parsedPerUom: parsedPer.parsedPerUom,
            isDefault: booleanOrNull(unit.isDefault),
            quantityAvailable: numberOrNull(unit.quantityAvailable),
            weight: numberOrNull(unit.weight),
            weightUnit: textOrNull(unit.weightUOM),
            length: numberOrNull(unit.length),
            width: numberOrNull(unit.width),
            height: numberOrNull(unit.height),
            dimensionUnit: textOrNull(unit.sizeUOM),
            gtin: textOrNull(unit.gtin),
            hcpcs: textOrNull(unit.hcpcsCode),
            volume: textOrNull(unit.volume),
            volumeUom: textOrNull(unit.volumeUOM),
            availability: textOrNull(unit.availability),
            rawPayload: unit,
          }
        }),
      })),
  }
}

export class ApiHerculesPricingSource implements HerculesPricingSource {
  readonly mode = 'api'
  readonly supplierCode?: string
  private readonly client: HerculesApiClient
  private readonly pageSize: number
  private readonly updatedSince: string | undefined
  private readonly costIsConfirmedContractCost: boolean
  private readonly lowRateLimitRemainingThreshold: number
  private readonly maxRateLimitRetries: number
  private readonly rateLimitFallbackDelayMs: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(options: ApiHerculesPricingSourceOptions) {
    this.client = options.client
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
    this.updatedSince = options.updatedSince
    this.costIsConfirmedContractCost = options.costIsConfirmedContractCost ?? false
    this.lowRateLimitRemainingThreshold = options.lowRateLimitRemainingThreshold ?? 10
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 1
    this.rateLimitFallbackDelayMs = options.rateLimitFallbackDelayMs ?? 5 * 60 * 1000
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  buildRequestBody(offset: number): HerculesApiRequestBody {
    const body: HerculesApiRequestBody = {
      limit: this.pageSize,
      offset,
    }

    if (this.updatedSince) {
      body.sortBy = 'updatedAt'
      body.sortOrder = 'ASC'
      body.filters = [
        {
          field: 'updatedAt',
          operator: 'gte',
          value: this.updatedSince,
        },
      ]
    }

    return body
  }

  async *getSupplierItems(): AsyncIterable<HerculesSupplierItemPayload> {
    let offset = 0

    while (true) {
      const { page, rateLimit } = await this.fetchPageWithRateLimitRetry(
        this.buildRequestBody(offset)
      )

      for (const part of page.data) {
        const normalized = normalizeHerculesApiPart(part as HerculesApiPart, {
          costIsConfirmedContractCost: this.costIsConfirmedContractCost,
        })
        if (normalized) yield normalized
      }

      if (!page.metadata.hasNext) break

      if (
        rateLimit.remaining !== null &&
        rateLimit.remaining <= this.lowRateLimitRemainingThreshold
      ) {
        await this.sleep(resetDelayMs(rateLimit.reset, this.rateLimitFallbackDelayMs))
      }

      offset = page.metadata.offset + page.metadata.count
    }
  }

  private async fetchPageWithRateLimitRetry(body: HerculesApiRequestBody) {
    let attempts = 0

    while (true) {
      try {
        return await this.client.listParts<HerculesApiPart>(body)
      } catch (error) {
        if (
          !(error instanceof HerculesRateLimitExceededError) ||
          attempts >= this.maxRateLimitRetries
        ) {
          throw error
        }

        attempts += 1
        await this.sleep(
          resetDelayMs(this.client.lastRateLimit.reset, this.rateLimitFallbackDelayMs)
        )
      }
    }
  }
}
