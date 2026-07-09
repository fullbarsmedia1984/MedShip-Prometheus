import {
  HerculesApiClient,
  HerculesRateLimitExceededError,
  type HerculesApiRequestBody,
} from './api-client'
import { parsePerText } from './per-parser'
import type {
  HerculesPricingSource,
  HerculesSupplierItemPayload,
  JsonObject,
} from './types'

type HerculesApiPartUnit = JsonObject & {
  unit?: unknown
  vendorPartNumber?: unknown
  uomTitle?: unknown
  price?: unknown
  contractPrice?: unknown
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
  updatedAt?: unknown
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
  status?: unknown
  imageUrl?: unknown
  images?: unknown
  imageURLs?: unknown
  vendors?: unknown
}

export type ApiHerculesPricingSourceOptions = {
  client: HerculesApiClient
  pageSize?: number
  initialOffset?: number
  updatedSince?: string
  supplierCode?: string
  useLegacyCostFallback?: boolean
  lowRateLimitRemainingThreshold?: number
  maxRateLimitRetries?: number
  rateLimitFallbackDelayMs?: number
  maxRateLimitDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

const MAX_PAGE_SIZE = 500
const DEFAULT_PAGE_SIZE = MAX_PAGE_SIZE
const DEFAULT_MAX_RATE_LIMIT_DELAY_MS = 65 * 60 * 1000

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

function resetDelayMs(reset: string | null, fallbackDelayMs: number, maxDelayMs: number) {
  const cappedFallbackDelayMs = Math.min(fallbackDelayMs, maxDelayMs)
  if (!reset) return cappedFallbackDelayMs
  const resetMs = Date.parse(reset)
  if (!Number.isFinite(resetMs)) return cappedFallbackDelayMs
  return Math.min(Math.max(0, resetMs - Date.now()), maxDelayMs)
}

function clampPageSize(pageSize: number | undefined) {
  if (pageSize === undefined) return DEFAULT_PAGE_SIZE
  if (!Number.isFinite(pageSize) || pageSize <= 0) return DEFAULT_PAGE_SIZE
  return Math.min(Math.floor(pageSize), MAX_PAGE_SIZE)
}

// Egress payloads populate Mongo references as {_id, name} objects
// (manufacturerId, vendorId); ingress-shaped fixtures carry flat name/id
// strings. Read both shapes.
function refField(value: unknown, field: '_id' | 'name') {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return textOrNull((value as { _id?: unknown; name?: unknown })[field])
  }
  return null
}

function flatOrNull(value: unknown) {
  if (value && typeof value === 'object') return null
  return textOrNull(value)
}

function vendorNameFor(vendor: HerculesApiPartVendor) {
  return textOrNull(vendor.vendorName) ?? refField(vendor.vendorId, 'name')
}

export function normalizeHerculesApiPart(
  part: HerculesApiPart,
  options: {
    useLegacyCostFallback?: boolean
  }
): HerculesSupplierItemPayload | null {
  const supplierItemId = textOrNull(part._id) ?? textOrNull(part.msId)
  if (!supplierItemId) return null

  const imageArray = Array.isArray(part.images)
    ? part.images
    : Array.isArray(part.imageURLs)
      ? part.imageURLs
      : null
  const images = imageArray
    ? imageArray.map(textOrNull).filter((value): value is string => value !== null)
    : textOrNull(part.imageUrl)
      ? [textOrNull(part.imageUrl) as string]
      : []

  return {
    supplierItemId,
    msId: textOrNull(part.msId),
    description: textOrNull(part.description),
    manufacturer: {
      id: refField(part.manufacturerId, '_id') ?? flatOrNull(part.manufacturerId),
      name: textOrNull(part.manufacturerName) ?? refField(part.manufacturerId, 'name'),
      partNumber: textOrNull(part.manufacturerPartNumber),
    },
    category: textOrNull(part.category),
    subcategory: textOrNull(part.subCategory) ?? textOrNull(part.subcategory),
    brand: textOrNull(part.brand) ?? textOrNull(part.title),
    countryOfOrigin: textOrNull(part.countryOfOrigin),
    unspsc: textOrNull(part.unspsc),
    status:
      textOrNull(part.status) ?? (part.isActive === false ? 'inactive' : 'active'),
    images,
    rawPayload: part,
    vendorOffers: arrayOrEmpty(part.vendors)
      .filter((vendor): vendor is HerculesApiPartVendor =>
        Boolean(vendorNameFor(vendor as HerculesApiPartVendor))
      )
      .map((vendor) => ({
        vendorName: vendorNameFor(vendor) as string,
        supplierCode: textOrNull(vendor.supplierCode),
        supplierId:
          textOrNull(vendor.supplierId) ??
          refField(vendor.vendorId, '_id') ??
          flatOrNull(vendor.vendorId) ??
          textOrNull(vendor._id),
        isPrimary: booleanOrFalse(vendor.isPrimary),
        vendorProductTitle: textOrNull(vendor.title),
        leadTime: textOrNull(vendor.leadTime),
        minimumOrderQuantity: numberOrNull(vendor.minimumOrderQuantity),
        rawPayload: vendor,
        uoms: arrayOrEmpty(vendor.units).map((unitValue) => {
          const unit = unitValue as HerculesApiPartUnit
          const parsedPer = parsePerText(unit.per)
          // Real egress units carry `cost` (catalog price) rather than
          // `price`; keep it as the list price so it is queryable without
          // asserting contract semantics (contractPrice stays authoritative
          // for cost eligibility).
          const listPrice =
            'price' in unit ? unit.price : 'cost' in unit ? unit.cost : null
          const contractPrice =
            'contractPrice' in unit || !options.useLegacyCostFallback
              ? 'contractPrice' in unit
                ? unit.contractPrice
                : null
              : unit.cost

          return {
            uomCode: textOrNull(unit.unit),
            vendorPartNumber: textOrNull(unit.vendorPartNumber),
            uomTitle: textOrNull(unit.uomTitle),
            listPrice: listPrice as string | number | null,
            contractPrice: contractPrice as string | number | null,
            contractPriceStatus: null,
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
  private readonly initialOffset: number
  private readonly updatedSince: string | undefined
  private readonly useLegacyCostFallback: boolean
  private readonly lowRateLimitRemainingThreshold: number
  private readonly maxRateLimitRetries: number
  private readonly rateLimitFallbackDelayMs: number
  private readonly maxRateLimitDelayMs: number
  private readonly sleep: (ms: number) => Promise<void>
  latestProcessedUpdatedAt: string | null = null

  constructor(options: ApiHerculesPricingSourceOptions) {
    this.client = options.client
    this.pageSize = clampPageSize(options.pageSize)
    this.initialOffset = Math.max(0, Math.floor(options.initialOffset ?? 0))
    this.updatedSince = options.updatedSince
    this.supplierCode = textOrNull(options.supplierCode) ?? undefined
    this.useLegacyCostFallback = options.useLegacyCostFallback ?? false
    this.lowRateLimitRemainingThreshold = options.lowRateLimitRemainingThreshold ?? 10
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 1
    this.rateLimitFallbackDelayMs = options.rateLimitFallbackDelayMs ?? 5 * 60 * 1000
    this.maxRateLimitDelayMs =
      options.maxRateLimitDelayMs ?? DEFAULT_MAX_RATE_LIMIT_DELAY_MS
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  buildRequestBody(offset: number): HerculesApiRequestBody {
    const body: HerculesApiRequestBody = {
      limit: this.pageSize,
      offset,
    }
    const filters: NonNullable<HerculesApiRequestBody['filters']> = []

    if (this.updatedSince) {
      body.sortBy = 'updatedAt'
      body.sortOrder = 'ASC'
      filters.push({
        field: 'updatedAt',
        operator: 'gte',
        value: this.updatedSince,
      })
    }

    if (this.supplierCode) {
      filters.push({
        field: 'vendors.supplierCode',
        operator: 'eq',
        value: this.supplierCode,
      })
    }

    if (filters.length > 0) {
      body.filters = filters
    }

    return body
  }

  async *getSupplierItems(): AsyncIterable<HerculesSupplierItemPayload> {
    for await (const page of this.getSupplierItemPages()) {
      for (const item of page.items) {
        yield item
      }
    }
  }

  async *getSupplierItemPages(): AsyncIterable<{
    offset: number
    count: number
    hasNext: boolean
    nextOffset: number | null
    items: HerculesSupplierItemPayload[]
    latestProcessedUpdatedAt: string | null
  }> {
    let offset = this.initialOffset

    while (true) {
      const { page, rateLimit } = await this.fetchPageWithRateLimitRetry(
        this.buildRequestBody(offset)
      )

      const items: HerculesSupplierItemPayload[] = []
      for (const part of page.data) {
        const normalized = normalizeHerculesApiPart(part as HerculesApiPart, {
          useLegacyCostFallback: this.useLegacyCostFallback,
        })
        if (normalized) {
          this.trackProcessedCursor(part as HerculesApiPart)
          items.push(normalized)
        }
      }

      const nextOffset = page.metadata.hasNext
        ? page.metadata.offset + page.metadata.count
        : null

      yield {
        offset: page.metadata.offset,
        count: page.metadata.count,
        hasNext: page.metadata.hasNext,
        nextOffset,
        items,
        latestProcessedUpdatedAt: this.latestProcessedUpdatedAt,
      }

      if (!page.metadata.hasNext) break

      if (
        rateLimit.remaining !== null &&
        rateLimit.remaining <= this.lowRateLimitRemainingThreshold
      ) {
        await this.sleep(
          resetDelayMs(
            rateLimit.reset,
            this.rateLimitFallbackDelayMs,
            this.maxRateLimitDelayMs
          )
        )
      }

      offset = nextOffset ?? 0
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
          resetDelayMs(
            this.client.lastRateLimit.reset,
            this.rateLimitFallbackDelayMs,
            this.maxRateLimitDelayMs
          )
        )
      }
    }
  }

  private trackProcessedCursor(part: HerculesApiPart) {
    const updatedAt = textOrNull(part.updatedAt)
    if (!updatedAt) return

    const updatedAtMs = Date.parse(updatedAt)
    if (!Number.isFinite(updatedAtMs)) return

    const currentMs = this.latestProcessedUpdatedAt
      ? Date.parse(this.latestProcessedUpdatedAt)
      : Number.NEGATIVE_INFINITY
    if (!Number.isFinite(currentMs) || updatedAtMs > currentMs) {
      this.latestProcessedUpdatedAt = updatedAt
    }
  }
}
