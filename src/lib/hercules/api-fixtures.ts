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

export const apiPartWithNumericContractPrice: HerculesApiPart = {
  _id: 'api-part-numeric-contract-price',
  msId: 'MS-api-numeric',
  manufacturerPartNumber: 'API-MPN-001',
  manufacturerName: 'API MANUFACTURER',
  description: 'API part with numeric contract price',
  category: 'API Fixtures',
  subCategory: 'Contract Prices',
  isActive: true,
  updatedAt: '2026-06-01T12:00:00.000Z',
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
          price: '$20.00',
          contractPrice: '$12.50',
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

export const apiPartWithNumericCost = apiPartWithNumericContractPrice

// Mirrors the real /api/v1/parts/list egress shape: manufacturer and
// vendor arrive as populated {_id, name} references, images as imageURLs,
// status as a string, and units carry `cost` (catalog price) with a null
// contractPrice.
export const apiPartWithPopulatedReferences: HerculesApiPart = {
  _id: '69ce302086f57d4ec14a9c9d',
  msId: 'MS-mnh8tyjl-g7hf95',
  title: 'PANT,FLAT FRONT,MENS,NAVY,48XU',
  brand: "Men's Synergy Flat-Front Dress Pants",
  status: 'Active',
  description: 'Lightweight, home-wash dress pants',
  category: 'Apparel',
  subCategory: 'Pants',
  manufacturerId: { _id: '69ce2fe986f57d4ec14a9a55', name: 'EDWARDS GARMENT CO' },
  manufacturerPartNumber: '2525 010 38 32',
  imageURLs: ['https://img.example.com/pants.jpg'],
  updatedAt: '2026-05-19T11:42:24.320Z',
  vendors: [
    {
      title: 'PANT,FLAT FRONT,MENS,NAVY,48XU',
      vendorId: { _id: '69ce2fb086f57d4ec14a99df', name: 'Medline' },
      isPrimary: true,
      leadTime: null,
      minimumOrderQuantity: 1,
      units: [
        {
          per: null,
          cost: 179.47,
          gtin: null,
          unit: 'EA',
          width: 5,
          height: 0.5,
          length: 10,
          weight: 0.31,
          uomTitle: 'PANT,FLAT FRONT,MENS,NAVY,48XU',
          isDefault: true,
          volumeUOM: 'EA',
          weightUOM: 'LB',
          contractPrice: null,
          packagingType: null,
          vendorPartNumber: '2525NV48XU',
        },
      ],
    },
  ],
}

export const apiPartWithNullContractPrice: HerculesApiPart = {
  _id: 'api-part-null-contract-price',
  msId: 'MS-api-missing',
  manufacturerPartNumber: 'API-MPN-002',
  manufacturerName: 'API MANUFACTURER',
  description: 'API part with null contract price',
  isActive: true,
  updatedAt: '2026-06-01T12:05:00.000Z',
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
          price: '$30.00',
          contractPrice: null,
          per: '1/EA',
        },
      ],
    },
  ],
}

export const apiPartWithMissingCost = apiPartWithNullContractPrice

export const apiPartWithBlankContractPrice: HerculesApiPart = {
  _id: 'api-part-blank-contract-price',
  msId: 'MS-api-blank',
  manufacturerPartNumber: 'API-MPN-005',
  manufacturerName: 'API MANUFACTURER',
  description: 'API part with blank contract price',
  isActive: true,
  vendors: [
    {
      _id: 'api-vendor-blank',
      vendorName: 'Medline',
      supplierCode: 'MEDLINE',
      isPrimary: true,
      units: [
        {
          unit: 'EA',
          vendorPartNumber: 'API-BLANK-001',
          price: '$40.00',
          contractPrice: '',
          per: '1/EA',
        },
      ],
    },
  ],
}

export const apiPartWithRequestQuoteContractPrice: HerculesApiPart = {
  _id: 'api-part-request-quote-contract-price',
  msId: 'MS-api-request-quote',
  manufacturerPartNumber: 'API-MPN-006',
  manufacturerName: 'API MANUFACTURER',
  description: 'API part with request-quote contract price',
  isActive: true,
  vendors: [
    {
      _id: 'api-vendor-request-quote',
      vendorName: 'NDC',
      supplierCode: 'NDC',
      isPrimary: true,
      units: [
        {
          unit: 'EA',
          vendorPartNumber: 'API-RFQ-001',
          price: '$50.00',
          contractPrice: 'List only - request quote',
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
      units: [
        {
          unit: 'EA',
          vendorPartNumber: 'API-MULTI-A',
          price: '$15.00',
          contractPrice: '$10.00',
          per: '1/EA',
        },
      ],
    },
    {
      _id: 'api-vendor-b',
      vendorName: 'NDC',
      supplierCode: 'NDC',
      isPrimary: false,
      units: [
        {
          unit: 'EA',
          vendorPartNumber: 'API-MULTI-B',
          price: '$16.00',
          contractPrice: '$11.00',
          per: '1/EA',
        },
      ],
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
          price: '$1.00',
          contractPrice: '$0.45',
          per: '1/EA',
          packagingType: 'each',
        },
        {
          unit: 'BX',
          vendorPartNumber: 'API-UNIT-BX',
          price: '$45.00',
          contractPrice: '$38.75',
          per: '100/BX',
          packagingType: 'box',
          isDefault: true,
        },
      ],
    },
  ],
}
