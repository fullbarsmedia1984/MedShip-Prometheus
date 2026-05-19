export type CostBasisSource =
  | 'contract_line'
  | 'product_cogs_contract'
  | 'fishbowl_standard'
  | 'vendor_purchase'
  | 'manual_cogs'

export type CostBasisInput = {
  contractLineCost?: number | null
  productCogsContractCost?: number | null
  fishbowlStandardCost?: number | null
  vendorPurchaseCost?: number | null
  manualCost?: number | null
}

export type CostBasisResult = {
  amount: number | null
  source: CostBasisSource | null
  missing: boolean
}

export type PricingGuardrailOutcome =
  | 'ready'
  | 'below_floor'
  | 'missing_product'
  | 'missing_contract_price'
  | 'missing_cogs'
  | 'expired_contract'
  | 'overlapping_contract'
  | 'currency_uom_mismatch'

export type PricingGuardrailInput = {
  productId?: string | null
  contractUnitPrice?: number | null
  costBasis?: number | CostBasisResult | null
  quotedUnitPrice?: number | null
  minimumMarginPct?: number | null
  currency?: string | null
  expectedCurrency?: string | null
  uom?: string | null
  expectedUom?: string | null
  asOf?: Date | string | null
  contractStartDate?: Date | string | null
  contractEndDate?: Date | string | null
  overlappingContractCount?: number | null
}

export type PricingGuardrailResult = {
  primaryOutcome: PricingGuardrailOutcome
  outcomes: PricingGuardrailOutcome[]
  belowFloor: boolean
  minimumQuotePrice: number | null
  grossMarginDollars: number | null
  grossMarginPct: number | null
}

const COST_PRECEDENCE: readonly [CostBasisSource, keyof CostBasisInput][] = [
  ['contract_line', 'contractLineCost'],
  ['product_cogs_contract', 'productCogsContractCost'],
  ['fishbowl_standard', 'fishbowlStandardCost'],
  ['vendor_purchase', 'vendorPurchaseCost'],
  ['manual_cogs', 'manualCost'],
]

function isPositiveAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFiniteAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeMarginPct(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const normalized = value > 1 ? value / 100 : value
  if (normalized < 0 || normalized >= 1) return null
  return normalized
}

function roundTo(value: number, decimals?: number) {
  if (decimals === undefined) return value
  const multiplier = 10 ** decimals
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier
}

function dateValue(value: Date | string | null | undefined) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isFinite(time) ? time : null
}

function comparableCode(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? ''
}

function resolveCostAmount(value: number | CostBasisResult | null | undefined) {
  if (typeof value === 'number') return value
  return value?.amount ?? null
}

export function calculateCostBasis(input: CostBasisInput): CostBasisResult {
  for (const [source, key] of COST_PRECEDENCE) {
    const amount = input[key]
    if (isPositiveAmount(amount)) {
      return {
        amount,
        source,
        missing: false,
      }
    }
  }

  return {
    amount: null,
    source: null,
    missing: true,
  }
}

export function calculateSuggestedRetailPrice(
  costBasis: number | null | undefined,
  targetMarginPct: number | null | undefined,
  decimals?: number
) {
  const marginPct = normalizeMarginPct(targetMarginPct)
  if (!isPositiveAmount(costBasis) || marginPct === null) return null
  return roundTo(costBasis / (1 - marginPct), decimals)
}

export function calculateMinimumQuotePrice(
  costBasis: number | null | undefined,
  minimumMarginPct: number | null | undefined,
  decimals?: number
) {
  const marginPct = normalizeMarginPct(minimumMarginPct)
  if (!isPositiveAmount(costBasis) || marginPct === null) return null
  return roundTo(costBasis / (1 - marginPct), decimals)
}

export function calculateGrossMarginDollars(
  quotedUnitPrice: number | null | undefined,
  costBasis: number | null | undefined,
  decimals?: number
) {
  if (!isFiniteAmount(quotedUnitPrice) || !isPositiveAmount(costBasis)) return null
  return roundTo(quotedUnitPrice - costBasis, decimals)
}

export function calculateGrossMarginPct(
  quotedUnitPrice: number | null | undefined,
  costBasis: number | null | undefined,
  decimals?: number
) {
  const grossMarginDollars = calculateGrossMarginDollars(quotedUnitPrice, costBasis)
  if (grossMarginDollars === null || !isPositiveAmount(quotedUnitPrice)) return null
  return roundTo(grossMarginDollars / quotedUnitPrice, decimals)
}

export function isBelowFloor(
  quotedUnitPrice: number | null | undefined,
  minimumQuotePrice: number | null | undefined
) {
  if (!isFiniteAmount(quotedUnitPrice) || !isPositiveAmount(minimumQuotePrice)) return false
  return quotedUnitPrice < minimumQuotePrice
}

export function getPricingGuardrailOutcomes(input: PricingGuardrailInput): PricingGuardrailOutcome[] {
  const outcomes: PricingGuardrailOutcome[] = []
  const costBasis = resolveCostAmount(input.costBasis)
  const asOf = dateValue(input.asOf) ?? Date.now()
  const contractStart = dateValue(input.contractStartDate)
  const contractEnd = dateValue(input.contractEndDate)
  const currencyMismatch =
    Boolean(input.currency && input.expectedCurrency) &&
    comparableCode(input.currency) !== comparableCode(input.expectedCurrency)
  const uomMismatch =
    Boolean(input.uom && input.expectedUom) &&
    comparableCode(input.uom) !== comparableCode(input.expectedUom)
  const minimumQuotePrice = calculateMinimumQuotePrice(costBasis, input.minimumMarginPct)

  if (!input.productId) outcomes.push('missing_product')
  if (!isPositiveAmount(input.contractUnitPrice)) outcomes.push('missing_contract_price')
  if (!isPositiveAmount(costBasis)) outcomes.push('missing_cogs')
  if ((contractStart !== null && asOf < contractStart) || (contractEnd !== null && asOf > contractEnd)) {
    outcomes.push('expired_contract')
  }
  if ((input.overlappingContractCount ?? 0) > 0) outcomes.push('overlapping_contract')
  if (currencyMismatch || uomMismatch) outcomes.push('currency_uom_mismatch')
  if (outcomes.length === 0 && isBelowFloor(input.quotedUnitPrice, minimumQuotePrice)) {
    outcomes.push('below_floor')
  }

  return outcomes.length > 0 ? outcomes : ['ready']
}

export function evaluatePricingGuardrails(input: PricingGuardrailInput): PricingGuardrailResult {
  const costBasis = resolveCostAmount(input.costBasis)
  const minimumQuotePrice = calculateMinimumQuotePrice(costBasis, input.minimumMarginPct)
  const belowFloor = isBelowFloor(input.quotedUnitPrice, minimumQuotePrice)
  const outcomes = getPricingGuardrailOutcomes(input)

  return {
    primaryOutcome: outcomes[0],
    outcomes,
    belowFloor,
    minimumQuotePrice,
    grossMarginDollars: calculateGrossMarginDollars(input.quotedUnitPrice, costBasis),
    grossMarginPct: calculateGrossMarginPct(input.quotedUnitPrice, costBasis),
  }
}
