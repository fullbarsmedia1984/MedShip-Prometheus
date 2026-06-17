import type { HerculesEgressPage } from './api-client'
import type { HerculesApiPart } from './api-source'

export function herculesApiEnvelope<T>(
  data: T,
  path = '/api/v1/parts/list',
  statusCode = 200,
  message = 'Success'
) {
  return {
    statusCode,
    message,
    data,
    error: null,
    timestamp: '2026-06-03T12:00:00.000Z',
    path,
  }
}

export function herculesApiPartsPage(
  data: HerculesApiPart[],
  options: {
    limit?: number
    offset?: number
    total?: number
    hasNext?: boolean
  } = {}
): HerculesEgressPage<HerculesApiPart> {
  const limit = options.limit ?? data.length
  const offset = options.offset ?? 0
  const total = options.total ?? data.length

  return {
    data,
    metadata: {
      total,
      limit,
      offset,
      currentPage: Math.floor(offset / Math.max(limit, 1)) + 1,
      totalPages: Math.ceil(total / Math.max(limit, 1)),
      hasNext: options.hasNext ?? offset + data.length < total,
      hasPrev: offset > 0,
      count: data.length,
    },
  }
}

export const apiPartWithNumericCost: HerculesApiPart = {
  _id: 'api-part-numeric-cost',
  msId: 'MS-api-numeric',
  manufacturerPartNumber: 'API-MPN-001',
  manufacturerName: 'API MANUFACTURER',
  description: 'API part with numeric cost',
  category: 'API Fixtures',
  subCategory: 'Costs',
  isActive: true,
  vendors: [
    {
      _id: 'api-vendor-medline',
      vendorName: 'Medline',
      supplierCode: 'MEDLINE',
      isPrimary: true,
      title: 'API NUMERIC COST OFFER',
      units: [
        {
          unit: 'EA',
          vendorPartNumber: 'API-COST-001',
          uomTitle: 'Each',
          cost: 12.5,
          per: '1/EA',
          isDefault: true,
          quantityAvailable: 22,
          packagingType: 'each',
          volume: 3.25,
          volumeUOM: 'CF',
        },
      ],
    },
  ],
}

export const apiPartWithMissingCost: HerculesApiPart = {
  _id: 'api-part-missing-cost',
  msId: 'MS-api-missing',
  manufacturerPartNumber: 'API-MPN-002',
  manufacturerName: 'API MANUFACTURER',
  description: 'API part with missing cost',
  isActive: true,
  vendors: [
    {
      _id: 'api-vendor-missing',
      vendorName: 'McKesson',
      supplierCode: 'MCKESSON',
      isPrimary: true,
      units: [
        {
          unit: 'EA',
          vendorPartNumber: 'API-MISSING-001',
          cost: null,
          per: '1/EA',
        },
      ],
    },
  ],
}

export const apiPartWithMultipleVendors: HerculesApiPart = {
  _id: 'api-part-multiple-vendors',
  msId: 'MS-api-vendors',
  manufacturerPartNumber: 'API-MPN-003',
  manufacturerName: 'API MANUFACTURER',
  description: 'API part with multiple vendors',
  isActive: true,
  vendors: [
    {
      _id: 'api-vendor-a',
      vendorName: 'Medline',
      supplierCode: 'MEDLINE',
      isPrimary: true,
      units: [{ unit: 'EA', vendorPartNumber: 'API-MULTI-A', cost: 10, per: '1/EA' }],
    },
    {
      _id: 'api-vendor-b',
      vendorName: 'NDC',
      supplierCode: 'NDC',
      isPrimary: false,
      units: [{ unit: 'EA', vendorPartNumber: 'API-MULTI-B', cost: 11, per: '1/EA' }],
    },
  ],
}

export const apiPartWithMultipleUnitsAndPerBox: HerculesApiPart = {
  _id: 'api-part-multiple-units',
  msId: 'MS-api-units',
  manufacturerPartNumber: 'API-MPN-004',
  manufacturerName: 'API MANUFACTURER',
  description: 'API part with multiple units',
  isActive: true,
  vendors: [
    {
      _id: 'api-vendor-units',
      vendorName: 'Medline',
      supplierCode: 'MEDLINE',
      isPrimary: true,
      units: [
        {
          unit: 'EA',
          vendorPartNumber: 'API-UNIT-EA',
          cost: 0.45,
          per: '1/EA',
          packagingType: 'each',
        },
        {
          unit: 'BX',
          vendorPartNumber: 'API-UNIT-BX',
          cost: 38.75,
          per: '100/BX',
          packagingType: 'box',
          isDefault: true,
        },
      ],
    },
  ],
}
