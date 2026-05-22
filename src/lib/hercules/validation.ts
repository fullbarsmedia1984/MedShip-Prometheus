import type {
  HerculesOfferUomPayload,
  HerculesSupplierItemPayload,
  HerculesVendorOfferPayload,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid Hercules payload: ${field} is required`)
  }
}

function optionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new Error(`Invalid Hercules payload: ${field} must be a string or null`)
  }
  return value
}

function optionalStringOrNumber(
  value: unknown,
  field: string
): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Invalid Hercules payload: ${field} must be text, number, or null`)
  }
  return value
}

function optionalBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid Hercules payload: ${field} must be a boolean`)
  }
  return value
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid Hercules payload: ${field} must be an array`)
  }

  return value.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new Error(`Invalid Hercules payload: ${field}[${index}] must be a string`)
    }
    return entry
  })
}

function validateUom(value: unknown, index: number): HerculesOfferUomPayload {
  if (!isRecord(value)) {
    throw new Error(`Invalid Hercules payload: vendorOffers.uoms[${index}] must be an object`)
  }

  return {
    uomCode: optionalString(value.uomCode, `uoms[${index}].uomCode`),
    vendorPartNumber: optionalString(value.vendorPartNumber, `uoms[${index}].vendorPartNumber`),
    uomTitle: optionalString(value.uomTitle, `uoms[${index}].uomTitle`),
    listPrice: optionalStringOrNumber(value.listPrice, `uoms[${index}].listPrice`),
    contractPrice: optionalStringOrNumber(value.contractPrice, `uoms[${index}].contractPrice`),
    package: optionalString(value.package, `uoms[${index}].package`),
    perQuantity: optionalStringOrNumber(value.perQuantity, `uoms[${index}].perQuantity`),
    weight: optionalStringOrNumber(value.weight, `uoms[${index}].weight`),
    weightUnit: optionalString(value.weightUnit, `uoms[${index}].weightUnit`),
    length: optionalStringOrNumber(value.length, `uoms[${index}].length`),
    width: optionalStringOrNumber(value.width, `uoms[${index}].width`),
    height: optionalStringOrNumber(value.height, `uoms[${index}].height`),
    dimensionUnit: optionalString(value.dimensionUnit, `uoms[${index}].dimensionUnit`),
    gtin: optionalString(value.gtin, `uoms[${index}].gtin`),
    hcpcs: optionalString(value.hcpcs, `uoms[${index}].hcpcs`),
    volume: optionalString(value.volume, `uoms[${index}].volume`),
    availability: optionalString(value.availability, `uoms[${index}].availability`),
  }
}

function validateVendorOffer(value: unknown, index: number): HerculesVendorOfferPayload {
  if (!isRecord(value)) {
    throw new Error(`Invalid Hercules payload: vendorOffers[${index}] must be an object`)
  }

  assertString(value.vendorName, `vendorOffers[${index}].vendorName`)

  if (!Array.isArray(value.uoms)) {
    throw new Error(`Invalid Hercules payload: vendorOffers[${index}].uoms must be an array`)
  }

  return {
    vendorName: value.vendorName,
    supplierCode: optionalString(value.supplierCode, `vendorOffers[${index}].supplierCode`),
    supplierId: optionalString(value.supplierId, `vendorOffers[${index}].supplierId`),
    isPrimary: optionalBoolean(value.isPrimary, `vendorOffers[${index}].isPrimary`),
    vendorProductTitle: optionalString(
      value.vendorProductTitle,
      `vendorOffers[${index}].vendorProductTitle`
    ),
    leadTime: optionalString(value.leadTime, `vendorOffers[${index}].leadTime`),
    minimumOrderQuantity: optionalStringOrNumber(
      value.minimumOrderQuantity,
      `vendorOffers[${index}].minimumOrderQuantity`
    ),
    uoms: value.uoms.map(validateUom),
  }
}

export function validateHerculesSupplierItemPayload(
  value: unknown
): HerculesSupplierItemPayload {
  if (!isRecord(value)) {
    throw new Error('Invalid Hercules payload: root must be an object')
  }

  assertString(value.supplierItemId, 'supplierItemId')

  if (!isRecord(value.manufacturer)) {
    throw new Error('Invalid Hercules payload: manufacturer must be an object')
  }

  if (!Array.isArray(value.vendorOffers)) {
    throw new Error('Invalid Hercules payload: vendorOffers must be an array')
  }

  return {
    supplierItemId: value.supplierItemId,
    msId: optionalString(value.msId, 'msId'),
    description: optionalString(value.description, 'description'),
    manufacturer: {
      id: optionalString(value.manufacturer.id, 'manufacturer.id'),
      name: optionalString(value.manufacturer.name, 'manufacturer.name'),
      partNumber: optionalString(value.manufacturer.partNumber, 'manufacturer.partNumber'),
    },
    category: optionalString(value.category, 'category'),
    subcategory: optionalString(value.subcategory, 'subcategory'),
    brand: optionalString(value.brand, 'brand'),
    countryOfOrigin: optionalString(value.countryOfOrigin, 'countryOfOrigin'),
    unspsc: optionalString(value.unspsc, 'unspsc'),
    status: optionalString(value.status, 'status'),
    images: stringArray(value.images, 'images'),
    vendorOffers: value.vendorOffers.map(validateVendorOffer),
  }
}
