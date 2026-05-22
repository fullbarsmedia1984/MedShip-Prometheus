import { contractPriceIneligibilityReason } from './price-parser'
import type {
  HerculesContractPriceStatus,
  HerculesCostIneligibilityReason,
} from './types'

export type CostEligibilityInput = {
  contractPriceAmount: number | null
  contractPriceStatus: HerculesContractPriceStatus
  supplierStatus: string | null
  itemStatus: string | null
  uomCode: string | null
  vendorPartNumber: string | null
  requireTrustedUomConversion?: boolean
  perQuantity?: number | null
}

export type CostEligibilityResult = {
  isCostEligible: boolean
  costIneligibilityReason: HerculesCostIneligibilityReason | null
}

function isInactive(status: string | null | undefined) {
  return status?.trim().toLowerCase() === 'inactive'
}

export function evaluateCostEligibility(
  input: CostEligibilityInput
): CostEligibilityResult {
  if (isInactive(input.supplierStatus)) {
    return {
      isCostEligible: false,
      costIneligibilityReason: 'supplier_inactive',
    }
  }

  if (isInactive(input.itemStatus)) {
    return {
      isCostEligible: false,
      costIneligibilityReason: 'item_inactive',
    }
  }

  if (!input.uomCode?.trim()) {
    return {
      isCostEligible: false,
      costIneligibilityReason: 'missing_uom',
    }
  }

  if (!input.vendorPartNumber?.trim()) {
    return {
      isCostEligible: false,
      costIneligibilityReason: 'missing_vendor_part_number',
    }
  }

  if (
    input.contractPriceStatus !== 'contract_available' ||
    input.contractPriceAmount === null
  ) {
    return {
      isCostEligible: false,
      costIneligibilityReason:
        contractPriceIneligibilityReason(input.contractPriceStatus) ?? 'unknown',
    }
  }

  if (input.requireTrustedUomConversion && input.perQuantity === null) {
    return {
      isCostEligible: false,
      costIneligibilityReason: 'uom_conversion_untrusted',
    }
  }

  return {
    isCostEligible: true,
    costIneligibilityReason: null,
  }
}
