import type { HerculesPricingSource, HerculesSupplierItemPayload } from './types'
import { validateHerculesSupplierItemPayload } from './validation'

export const observedMedlineSupplierItemFixture =
  validateHerculesSupplierItemPayload({
    supplierItemId: '69ce31d486f57d4ec14fc311',
    msId: 'MS-mnh92wou-3wpmbu',
    description:
      '"Advanced Technology" foam is manufactured specifically for the controlled environment industry allowing 25% more liquid absorption and two times more liquid release than competing foams.',
    manufacturer: {
      id: '69ce318986f57d4ec14ee3aa',
      name: 'VILEDA PROFESSIONAL',
      partNumber: '118770',
    },
    category: 'Housekeeping',
    subcategory: 'Cleaning Supplies',
    brand: 'Roll-O-Matic Original Mop, Refill, 4110R, 10"',
    countryOfOrigin: null,
    unspsc: '47131818',
    status: 'active',
    images: ['placeholder-from-hercules'],
    vendorOffers: [
      {
        vendorName: 'Medline',
        supplierCode: 'MEDLINE',
        supplierId: '69ce2fb086f57d4ec14a99df',
        isPrimary: true,
        vendorProductTitle: 'MOP,ROLL-O-MATIC,4110R,ORIGNL,REFILL,10',
        leadTime: null,
        minimumOrderQuantity: null,
        uoms: [
          {
            uomCode: 'EA',
            vendorPartNumber: 'FHEI18770',
            uomTitle: 'MOP,ROLL-O-MATIC,4110R,ORIGNL,REFILL,10',
            listPrice: '$234.56',
            contractPrice: 'List only — request quote',
            package: 'case',
            perQuantity: null,
            weight: '0.417',
            weightUnit: 'LB',
            length: '3.878',
            width: '3.878',
            height: '3.878',
            dimensionUnit: 'IN',
            gtin: null,
            hcpcs: null,
            volume: null,
            availability: null,
          },
          {
            uomCode: 'CS',
            vendorPartNumber: 'FHEI18770',
            uomTitle: 'MOP,ROLL-O-MATIC,4110R,ORIGNL,REFILL,10',
            listPrice: '$234.56',
            contractPrice: 'List only — request quote',
            package: 'case',
            perQuantity: 12,
            weight: '0.417',
            weightUnit: 'LB',
            length: '3.878',
            width: '3.878',
            height: '3.878',
            dimensionUnit: 'IN',
            gtin: null,
            hcpcs: null,
            volume: null,
            availability: null,
          },
        ],
      },
    ],
  })

export const numericContractPriceSupplierItemFixture =
  validateHerculesSupplierItemPayload({
    supplierItemId: 'fixture-numeric-contract-item',
    msId: 'MS-numeric-contract',
    description: 'Fixture item with numeric Hercules contract pricing.',
    manufacturer: {
      id: 'fixture-manufacturer',
      name: 'FIXTURE MANUFACTURER',
      partNumber: 'MFG-TEST123',
    },
    category: 'Fixtures',
    subcategory: 'Pricing',
    brand: 'Numeric Contract Fixture',
    countryOfOrigin: null,
    unspsc: null,
    status: 'active',
    images: [],
    vendorOffers: [
      {
        vendorName: 'Medline',
        supplierCode: 'MEDLINE',
        supplierId: '69ce2fb086f57d4ec14a99df',
        isPrimary: true,
        vendorProductTitle: 'NUMERIC CONTRACT FIXTURE',
        leadTime: null,
        minimumOrderQuantity: null,
        uoms: [
          {
            uomCode: 'EA',
            vendorPartNumber: 'TEST123',
            uomTitle: 'Numeric contract fixture',
            listPrice: '$20.00',
            contractPrice: '$12.50',
            package: 'each',
            perQuantity: 1,
          },
        ],
      },
    ],
  })

export class FixtureHerculesPricingSource implements HerculesPricingSource {
  readonly mode = 'fixture'

  constructor(
    private readonly items: HerculesSupplierItemPayload[] = [
      observedMedlineSupplierItemFixture,
      numericContractPriceSupplierItemFixture,
    ],
    readonly supplierCode = 'MEDLINE'
  ) {}

  async *getSupplierItems() {
    for (const item of this.items) {
      yield item
    }
  }
}
