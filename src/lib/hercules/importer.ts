import { evaluateCostEligibility } from './eligibility'
import { parseContractPrice, parseMoneyAmount } from './price-parser'
import { hashParts, hashPayload } from './source-identity'
import type {
  HerculesImportJobCounters,
  HerculesImportRepository,
  HerculesPricingSource,
  JsonObject,
} from './types'

const emptyCounters = (): HerculesImportJobCounters => ({
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

function cleanText(value: string | null | undefined) {
  const text = value?.trim()
  return text ? text : null
}

function numberOrNull(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function asRawPayload(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

function rawPayloadFrom(value: { rawPayload?: JsonObject }) {
  return value.rawPayload ?? asRawPayload(value)
}

function supplierStatusForFixture() {
  return 'Active'
}

function recordUpsert(counter: HerculesImportJobCounters, created: boolean) {
  if (created) {
    counter.rowsInserted += 1
  } else {
    counter.rowsUpdated += 1
  }
}

export async function importHerculesPricing(
  source: HerculesPricingSource,
  repository: HerculesImportRepository
) {
  const counters = emptyCounters()
  const errors: string[] = []
  const job = await repository.createImportJob({
    sourceMode: source.mode,
    supplierCode: source.supplierCode ?? null,
  })

  try {
    for await (const item of source.getSupplierItems()) {
      counters.rowsSeen += 1

      try {
        const catalogRawPayload = rawPayloadFrom(item)
        const catalogItem = await repository.upsertCatalogItem({
          sourceKey: hashParts('hercules_catalog_item', [item.supplierItemId]),
          sourcePayloadHash: hashPayload(catalogRawPayload),
          herculesItemId: item.supplierItemId,
          msId: cleanText(item.msId),
          description: cleanText(item.description),
          brand: cleanText(item.brand),
          manufacturerHerculesId: cleanText(item.manufacturer.id),
          manufacturerName: cleanText(item.manufacturer.name),
          manufacturerPartNumber: cleanText(item.manufacturer.partNumber),
          category: cleanText(item.category),
          subcategory: cleanText(item.subcategory),
          unspsc: cleanText(item.unspsc),
          countryOfOrigin: cleanText(item.countryOfOrigin),
          status: cleanText(item.status),
          imageUrls: item.images,
          rawPayload: catalogRawPayload,
          lastSeenImportJobId: job.id,
        })
        recordUpsert(counters, catalogItem.created)

        for (const [offerIndex, offer] of item.vendorOffers.entries()) {
          const supplierIdentity =
            offer.supplierId ?? offer.supplierCode ?? offer.vendorName
          const supplierRawPayload = asRawPayload({
            supplierId: offer.supplierId,
            supplierCode: offer.supplierCode,
            vendorName: offer.vendorName,
          })
          const supplier = await repository.upsertSupplier({
            sourceKey: hashParts('hercules_supplier', [
              supplierIdentity,
            ]),
            sourcePayloadHash: hashPayload(supplierRawPayload),
            herculesSupplierId: cleanText(offer.supplierId),
            supplierCode: cleanText(offer.supplierCode),
            supplierName: offer.vendorName,
            isVendor: true,
            isManufacturer: false,
            isDirect: false,
            status: supplierStatusForFixture(),
            rawPayload: supplierRawPayload,
            lastSeenImportJobId: job.id,
          })
          recordUpsert(counters, supplier.created)

          const offerRawPayload = rawPayloadFrom(offer)
          const vendorOfferSourceKey = hashParts('hercules_vendor_offer', [
            item.supplierItemId,
            supplierIdentity,
            offerIndex,
          ])
          const vendorOffer = await repository.upsertVendorOffer({
            sourceKey: vendorOfferSourceKey,
            sourcePayloadHash: hashPayload(offerRawPayload),
            herculesCatalogItemId: catalogItem.record.id,
            herculesItemId: item.supplierItemId,
            supplierId: supplier.record.id,
            supplierCode: cleanText(offer.supplierCode),
            vendorName: offer.vendorName,
            vendorProductTitle: cleanText(offer.vendorProductTitle) ?? '',
            isPrimary: offer.isPrimary,
            leadTime: cleanText(offer.leadTime),
            minimumOrderQuantity: numberOrNull(offer.minimumOrderQuantity),
            rawPayload: offerRawPayload,
            lastSeenImportJobId: job.id,
          })
          recordUpsert(counters, vendorOffer.created)

          for (const uom of offer.uoms) {
            const parsedContractPrice = parseContractPrice(uom.contractPrice)
            const contractPrice = {
              ...parsedContractPrice,
              status: uom.contractPriceStatus ?? parsedContractPrice.status,
            }
            const listPriceAmount = parseMoneyAmount(uom.listPrice)
            const uomCode = cleanText(uom.uomCode)
            const vendorPartNumber = cleanText(uom.vendorPartNumber)
            const packageName = cleanText(uom.package)
            const parsedPerQuantity = numberOrNull(uom.parsedPerQuantity)
            const perQuantity = parsedPerQuantity ?? numberOrNull(uom.perQuantity)
            const uomRawPayload = rawPayloadFrom(uom)

            if (contractPrice.amount !== null) {
              counters.numericContractPriceCount += 1
            }

            if (contractPrice.status === 'list_only_request_quote') {
              counters.requestQuotePriceCount += 1
            } else if (contractPrice.status === 'list_only') {
              counters.listOnlyPriceCount += 1
            }

            if (!uomCode) counters.missingUomCount += 1
            if (!vendorPartNumber) counters.missingVendorPartNumberCount += 1

            const eligibility = evaluateCostEligibility({
              contractPriceAmount: contractPrice.amount,
              contractPriceStatus: contractPrice.status,
              supplierStatus: supplier.record.status,
              itemStatus: item.status,
              uomCode,
              vendorPartNumber,
              perQuantity,
            })

            const offerUom = await repository.upsertOfferUom({
              sourceKey: hashParts('hercules_offer_uom', [
                vendorOfferSourceKey,
                vendorPartNumber,
                uomCode,
                packageName,
                perQuantity,
              ]),
              sourcePayloadHash: hashPayload(uomRawPayload),
              herculesVendorOfferId: vendorOffer.record.id,
              uomCode,
              vendorPartNumber,
              uomTitle: cleanText(uom.uomTitle),
              package: packageName,
              perQuantity,
              rawPerText: cleanText(uom.rawPerText),
              parsedPerQuantity,
              parsedPerUom: cleanText(uom.parsedPerUom),
              listPriceAmount,
              contractPriceAmount: contractPrice.amount,
              contractPriceStatus: contractPrice.status,
              rawContractPriceText: contractPrice.rawText,
              currency: 'USD',
              weight: numberOrNull(uom.weight),
              weightUnit: cleanText(uom.weightUnit),
              length: numberOrNull(uom.length),
              width: numberOrNull(uom.width),
              height: numberOrNull(uom.height),
              dimensionUnit: cleanText(uom.dimensionUnit),
              gtin: cleanText(uom.gtin),
              hcpcs: cleanText(uom.hcpcs),
              volume: cleanText(uom.volume),
              volumeUom: cleanText(uom.volumeUom),
              isDefault: uom.isDefault ?? null,
              quantityAvailable: numberOrNull(uom.quantityAvailable),
              availability: cleanText(uom.availability),
              isCostEligible: eligibility.isCostEligible,
              costIneligibilityReason: eligibility.costIneligibilityReason,
              rawPayload: uomRawPayload,
              lastSeenImportJobId: job.id,
            })
            recordUpsert(counters, offerUom.created)
          }
        }
      } catch (error) {
        counters.rowsRejected += 1
        errors.push(error instanceof Error ? error.message : 'Unknown Hercules import error')
      }
    }

    await repository.completeImportJob(job.id, {
      status: errors.length > 0 ? 'partial' : 'success',
      counters,
      errors,
    })

    return {
      jobId: job.id,
      status: errors.length > 0 ? 'partial' : 'success',
      counters,
      errors,
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown Hercules import error')
    await repository.completeImportJob(job.id, {
      status: 'failed',
      counters,
      errors,
    })
    throw error
  }
}
