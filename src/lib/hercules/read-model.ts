import type {
  HerculesAdminPricingResult,
  ZeusEligibleSupplierCost,
} from './types'

export type HerculesPricingReadRepository = {
  getEligibleSupplierCostsForZeusProduct(
    zeusProductId: string
  ): Promise<ZeusEligibleSupplierCost[]> | ZeusEligibleSupplierCost[]
  getAdminPricingForHerculesItem(
    herculesItemId: string
  ): Promise<HerculesAdminPricingResult> | HerculesAdminPricingResult
}

export async function getZeusEligibleSupplierCosts(
  repository: HerculesPricingReadRepository,
  zeusProductId: string
) {
  return repository.getEligibleSupplierCostsForZeusProduct(zeusProductId)
}

export async function getHerculesAdminPricing(
  repository: HerculesPricingReadRepository,
  herculesItemId: string
) {
  return repository.getAdminPricingForHerculesItem(herculesItemId)
}
