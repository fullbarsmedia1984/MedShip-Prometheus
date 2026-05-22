import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateCostEligibility } from '../eligibility'
import {
  FixtureHerculesPricingSource,
  observedMedlineSupplierItemFixture,
} from '../fixtures'
import { importHerculesPricing } from '../importer'
import { InMemoryHerculesImportRepository } from '../in-memory-repository'
import { parseContractPrice, parseMoneyAmount } from '../price-parser'
import {
  getHerculesAdminPricing,
  getZeusEligibleSupplierCosts,
} from '../read-model'
import { validateHerculesSupplierItemPayload } from '../validation'

describe('Hercules price parsing', () => {
  it('parses numeric money and maps non-numeric statuses', () => {
    assert.equal(parseMoneyAmount('$234.56'), 234.56)
    assert.equal(parseMoneyAmount('234.56'), 234.56)

    assert.deepEqual(parseContractPrice('List only — request quote'), {
      amount: null,
      status: 'list_only_request_quote',
      rawText: 'List only — request quote',
    })
    assert.deepEqual(parseContractPrice('Not provided'), {
      amount: null,
      status: 'not_provided',
      rawText: 'Not provided',
    })
    assert.deepEqual(parseContractPrice(null), {
      amount: null,
      status: 'not_provided',
      rawText: null,
    })
    assert.deepEqual(parseContractPrice(''), {
      amount: null,
      status: 'not_provided',
      rawText: null,
    })
    assert.deepEqual(parseContractPrice('ABC'), {
      amount: null,
      status: 'parse_error',
      rawText: 'ABC',
    })
    assert.deepEqual(parseContractPrice('$12.50'), {
      amount: 12.5,
      status: 'contract_available',
      rawText: '$12.50',
    })
  })
})

describe('Hercules cost eligibility', () => {
  it('accepts only numeric available contract prices with required identifiers', () => {
    assert.deepEqual(
      evaluateCostEligibility({
        contractPriceAmount: 12.5,
        contractPriceStatus: 'contract_available',
        supplierStatus: 'Active',
        itemStatus: 'active',
        uomCode: 'EA',
        vendorPartNumber: 'TEST123',
      }),
      {
        isCostEligible: true,
        costIneligibilityReason: null,
      }
    )

    assert.equal(
      evaluateCostEligibility({
        contractPriceAmount: null,
        contractPriceStatus: 'list_only_request_quote',
        supplierStatus: 'Active',
        itemStatus: 'active',
        uomCode: 'EA',
        vendorPartNumber: 'TEST123',
      }).costIneligibilityReason,
      'contract_price_requires_quote'
    )
    assert.equal(
      evaluateCostEligibility({
        contractPriceAmount: null,
        contractPriceStatus: 'not_provided',
        supplierStatus: 'Active',
        itemStatus: 'active',
        uomCode: 'EA',
        vendorPartNumber: 'TEST123',
      }).costIneligibilityReason,
      'contract_price_not_provided'
    )
    assert.equal(
      evaluateCostEligibility({
        contractPriceAmount: null,
        contractPriceStatus: 'parse_error',
        supplierStatus: 'Active',
        itemStatus: 'active',
        uomCode: 'EA',
        vendorPartNumber: 'TEST123',
      }).costIneligibilityReason,
      'contract_price_parse_error'
    )
    assert.equal(
      evaluateCostEligibility({
        contractPriceAmount: 12.5,
        contractPriceStatus: 'contract_available',
        supplierStatus: 'Active',
        itemStatus: 'active',
        uomCode: null,
        vendorPartNumber: 'TEST123',
      }).costIneligibilityReason,
      'missing_uom'
    )
    assert.equal(
      evaluateCostEligibility({
        contractPriceAmount: 12.5,
        contractPriceStatus: 'contract_available',
        supplierStatus: 'Active',
        itemStatus: 'active',
        uomCode: 'EA',
        vendorPartNumber: null,
      }).costIneligibilityReason,
      'missing_vendor_part_number'
    )
    assert.equal(
      evaluateCostEligibility({
        contractPriceAmount: 12.5,
        contractPriceStatus: 'contract_available',
        supplierStatus: 'Inactive',
        itemStatus: 'active',
        uomCode: 'EA',
        vendorPartNumber: 'TEST123',
      }).costIneligibilityReason,
      'supplier_inactive'
    )
    assert.equal(
      evaluateCostEligibility({
        contractPriceAmount: 12.5,
        contractPriceStatus: 'contract_available',
        supplierStatus: 'Active',
        itemStatus: 'inactive',
        uomCode: 'EA',
        vendorPartNumber: 'TEST123',
      }).costIneligibilityReason,
      'item_inactive'
    )
  })
})

describe('Hercules fixture importer', () => {
  it('imports the observed Medline fixture and preserves distinct UOM rows', async () => {
    const repository = new InMemoryHerculesImportRepository()
    const result = await importHerculesPricing(
      new FixtureHerculesPricingSource([observedMedlineSupplierItemFixture]),
      repository
    )

    assert.equal(result.status, 'success')
    assert.equal(repository.suppliers.size, 1)
    assert.equal(repository.catalogItems.size, 1)
    assert.equal(repository.vendorOffers.size, 1)
    assert.equal(repository.offerUoms.size, 2)
    assert.equal(result.counters.requestQuotePriceCount, 2)

    const uoms = [...repository.offerUoms.values()].sort((left, right) =>
      String(left.uomCode).localeCompare(String(right.uomCode))
    )

    assert.deepEqual(
      uoms.map((uom) => uom.uomCode),
      ['CS', 'EA']
    )
    assert.equal(uoms[0].perQuantity, 12)
    assert.equal(uoms[1].perQuantity, null)

    for (const uom of uoms) {
      assert.equal(uom.listPriceAmount, 234.56)
      assert.equal(uom.contractPriceAmount, null)
      assert.equal(uom.contractPriceStatus, 'list_only_request_quote')
      assert.equal(uom.isCostEligible, false)
      assert.equal(uom.costIneligibilityReason, 'contract_price_requires_quote')
      assert.equal(uom.rawContractPriceText, 'List only — request quote')
      assert.equal(uom.rawPayload.contractPrice, 'List only — request quote')
    }

    const catalogItem = [...repository.catalogItems.values()][0]
    assert.equal(catalogItem.rawPayload.supplierItemId, '69ce31d486f57d4ec14fc311')
  })

  it('is idempotent and updates existing rows on duplicate imports', async () => {
    const repository = new InMemoryHerculesImportRepository()
    const source = new FixtureHerculesPricingSource([observedMedlineSupplierItemFixture])

    await importHerculesPricing(source, repository)
    const firstEaRow = [...repository.offerUoms.values()].find(
      (uom) => uom.uomCode === 'EA'
    )
    assert.ok(firstEaRow)

    const secondResult = await importHerculesPricing(source, repository)

    assert.equal(repository.suppliers.size, 1)
    assert.equal(repository.catalogItems.size, 1)
    assert.equal(repository.vendorOffers.size, 1)
    assert.equal(repository.offerUoms.size, 2)
    assert.equal(secondResult.counters.rowsInserted, 0)
    assert.equal(secondResult.counters.rowsUpdated, 5)

    const eaRows = [...repository.offerUoms.values()].filter(
      (uom) => uom.uomCode === 'EA' && uom.perQuantity === null
    )
    assert.equal(eaRows.length, 1)
    assert.equal(eaRows[0].sourceKey, firstEaRow.sourceKey)
    assert.match(eaRows[0].sourceKey, /^hercules_offer_uom:[a-f0-9]{64}$/)
    assert.match(eaRows[0].sourcePayloadHash, /^[a-f0-9]{64}$/)
  })

  it('normalizes missing and null perQuantity to the same UOM source identity', async () => {
    const repository = new InMemoryHerculesImportRepository()
    const rawFixture = JSON.parse(JSON.stringify(observedMedlineSupplierItemFixture)) as {
      vendorOffers: Array<{ uoms: Array<Record<string, unknown>> }>
    }
    delete rawFixture.vendorOffers[0].uoms[0].perQuantity
    const missingPerQuantityFixture = validateHerculesSupplierItemPayload(rawFixture)

    await importHerculesPricing(
      new FixtureHerculesPricingSource([observedMedlineSupplierItemFixture]),
      repository
    )
    const firstEaRow = [...repository.offerUoms.values()].find(
      (uom) => uom.uomCode === 'EA'
    )
    assert.ok(firstEaRow)

    await importHerculesPricing(
      new FixtureHerculesPricingSource([missingPerQuantityFixture]),
      repository
    )

    const eaRows = [...repository.offerUoms.values()].filter(
      (uom) => uom.uomCode === 'EA' && uom.perQuantity === null
    )
    assert.equal(eaRows.length, 1)
    assert.equal(eaRows[0].sourceKey, firstEaRow.sourceKey)
  })

  it('scopes UOM source identity under the parent vendor offer', async () => {
    const repository = new InMemoryHerculesImportRepository()
    const rawFixture = JSON.parse(JSON.stringify(observedMedlineSupplierItemFixture)) as {
      vendorOffers: Array<Record<string, unknown> & { uoms: Array<Record<string, unknown>> }>
    }
    rawFixture.vendorOffers.push({
      ...rawFixture.vendorOffers[0],
      vendorProductTitle: 'UPDATED DISPLAY TITLE FOR SAME OFFER-LIKE UOM',
      uoms: [
        {
          ...rawFixture.vendorOffers[0].uoms[0],
        },
      ],
    })
    rawFixture.vendorOffers[0].uoms = [rawFixture.vendorOffers[0].uoms[0]]

    const sameSupplierDuplicateUomFixture =
      validateHerculesSupplierItemPayload(rawFixture)

    await importHerculesPricing(
      new FixtureHerculesPricingSource([sameSupplierDuplicateUomFixture]),
      repository
    )

    const eaRows = [...repository.offerUoms.values()].filter(
      (uom) =>
        uom.uomCode === 'EA' &&
        uom.vendorPartNumber === 'FHEI18770' &&
        uom.package === 'case' &&
        uom.perQuantity === null
    )

    assert.equal(repository.vendorOffers.size, 2)
    assert.equal(eaRows.length, 2)
    assert.notEqual(eaRows[0].sourceKey, eaRows[1].sourceKey)
  })

  it('marks numeric contract prices eligible and exposes only approved eligible Zeus costs', async () => {
    const repository = new InMemoryHerculesImportRepository()
    await importHerculesPricing(new FixtureHerculesPricingSource(), repository)

    const eligibleUom = [...repository.offerUoms.values()].find(
      (uom) => uom.vendorPartNumber === 'TEST123'
    )
    assert.ok(eligibleUom)
    assert.equal(eligibleUom.contractPriceAmount, 12.5)
    assert.equal(eligibleUom.contractPriceStatus, 'contract_available')
    assert.equal(eligibleUom.isCostEligible, true)

    const ineligibleUom = [...repository.offerUoms.values()].find(
      (uom) => uom.vendorPartNumber === 'FHEI18770'
    )
    assert.ok(ineligibleUom)

    repository.approveMapping({
      zeusProductId: 'Z123',
      herculesOfferUomId: eligibleUom.id,
    })
    repository.approveMapping({
      zeusProductId: 'Z123',
      herculesOfferUomId: ineligibleUom.id,
    })

    const costs = await getZeusEligibleSupplierCosts(repository, 'Z123')

    assert.equal(costs.length, 1)
    assert.equal(costs[0].vendorPartNumber, 'TEST123')
    assert.equal(costs[0].contractPrice, 12.5)
    assert.equal(costs[0].contractPriceStatus, 'contract_available')
    assert.equal(costs[0].source, 'hercules')
  })

  it('returns admin/debug pricing with eligible and ineligible rows', async () => {
    const repository = new InMemoryHerculesImportRepository()
    await importHerculesPricing(new FixtureHerculesPricingSource(), repository)

    const result = await getHerculesAdminPricing(
      repository,
      '69ce31d486f57d4ec14fc311'
    )

    assert.equal(result.supplier, 'Medline')
    assert.equal(result.uoms.length, 2)
    assert.ok(result.uoms.every((uom) => uom.isCostEligible === false))
    assert.ok(
      result.uoms.every(
        (uom) => uom.costIneligibilityReason === 'contract_price_requires_quote'
      )
    )
    assert.ok(result.uoms.every((uom) => uom.listPrice === 234.56))
  })
})
