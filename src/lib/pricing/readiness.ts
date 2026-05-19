import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  calculateMinimumQuotePrice,
  calculateSuggestedRetailPrice,
  evaluatePricingGuardrails,
} from './calculator'
import {
  normalizeFishbowlPartNumber,
  normalizeSalesforceProductCode,
} from './normalization'

type ReadinessStatus = 'ready' | 'warning' | 'blocker' | 'coming_soon'

type ReadinessMetric = {
  key: string
  label: string
  value: number
  total?: number
  unit?: 'count' | 'percent'
}

type ReadinessCheck = {
  key: string
  label: string
  status: ReadinessStatus
  message: string
  owner: string
  metrics: ReadinessMetric[]
  nextAction: string
}

export type PricingReadinessReport = {
  generatedAt: string
  overallStatus: ReadinessStatus
  summary: {
    checks: number
    ready: number
    warnings: number
    blockers: number
    comingSoon: number
  }
  checks: ReadinessCheck[]
}

type CountResult = {
  count: number
  available: boolean
}

type PricingRuleRow = {
  target_margin_pct: number | string | null
  minimum_margin_pct: number | string | null
}

type SupabaseRangeQuery<T> = {
  range(from: number, to: number): Promise<{
    data: T[] | null
    error: Error | null
  }>
}

type SupabaseCountQuery = PromiseLike<{
  count: number | null
  error: Error | null
}> & {
  not(column: string, operator: string, value: unknown): SupabaseCountQuery
}

const PAGE_SIZE = 1000

function isMissingRelationError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: string; message?: string }
  const message = candidate.message?.toLowerCase() ?? ''
  return (
    candidate.code === '42P01' ||
    candidate.code === 'PGRST205' ||
    message.includes('does not exist') ||
    message.includes('could not find the table')
  )
}

async function safeCount(
  table: string,
  buildQuery?: (query: SupabaseCountQuery) => SupabaseCountQuery
): Promise<CountResult> {
  const supabase = createAdminClient()
  let query = supabase
    .from(table)
    .select('id', { count: 'exact', head: true }) as unknown as SupabaseCountQuery

  if (buildQuery) {
    query = buildQuery(query)
  }

  const { count, error } = await query

  if (error) {
    if (isMissingRelationError(error)) return { count: 0, available: false }
    throw error
  }

  return { count: count ?? 0, available: true }
}

async function fetchAll<T>(
  buildQuery: () => SupabaseRangeQuery<T>
): Promise<T[]> {
  const rows: T[] = []
  let from = 0

  while (true) {
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1)

    if (error) {
      if (isMissingRelationError(error)) return []
      throw error
    }

    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return rows
}

function percent(value: number, total: number) {
  if (total <= 0) return 0
  return Math.round((value / total) * 1000) / 10
}

function toNumber(value: number | string | null | undefined): number | null {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function overallStatus(checks: ReadinessCheck[]): ReadinessStatus {
  if (checks.some((check) => check.status === 'blocker')) return 'blocker'
  if (checks.some((check) => check.status === 'warning')) return 'warning'
  if (checks.some((check) => check.status === 'coming_soon')) return 'coming_soon'
  return 'ready'
}

async function getActivePricingRule(): Promise<PricingRuleRow | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('pricing_rules')
    .select('target_margin_pct, minimum_margin_pct')
    .eq('is_active', true)
    .order('priority')
    .limit(1)
    .maybeSingle()

  if (error) {
    if (isMissingRelationError(error)) return null
    throw error
  }

  return data as PricingRuleRow | null
}

export async function getPricingReadinessReport(): Promise<PricingReadinessReport> {
  const supabase = createAdminClient()

  const [
    sfProducts,
    sfProductsWithCode,
    inventoryParts,
    inventoryWithPartNumber,
    inventoryWithSfProductId,
    opportunityLines,
    opportunityLinesWithProductCode,
    fbSalesOrderItems,
    productCrosswalkRows,
    contractLines,
    cogsRows,
    pricingRules,
    activePricingRule,
  ] = await Promise.all([
    safeCount('sf_products'),
    safeCount('sf_products', (query) => query.not('product_code', 'is', null)),
    safeCount('inventory_snapshot'),
    safeCount('inventory_snapshot', (query) => query.not('part_number', 'is', null)),
    safeCount('inventory_snapshot', (query) => query.not('sf_product_id', 'is', null)),
    safeCount('sf_opportunity_line_items'),
    safeCount('sf_opportunity_line_items', (query) => query.not('product_code', 'is', null)),
    safeCount('fb_sales_order_items'),
    safeCount('product_crosswalk'),
    safeCount('contract_price_lines'),
    safeCount('product_cogs'),
    safeCount('pricing_rules'),
    getActivePricingRule(),
  ])

  const [productCodes, partNumbers] = await Promise.all([
    fetchAll<{ product_code: string | null }>(() =>
      supabase
        .from('sf_products')
        .select('product_code')
        .not('product_code', 'is', null) as unknown as SupabaseRangeQuery<{ product_code: string | null }>
    ),
    fetchAll<{ part_number: string | null }>(() =>
      supabase
        .from('inventory_snapshot')
        .select('part_number')
        .not('part_number', 'is', null) as unknown as SupabaseRangeQuery<{ part_number: string | null }>
    ),
  ])

  const normalizedProductCodes = new Set(
    productCodes.flatMap((row) =>
      normalizeSalesforceProductCode(row.product_code).matchKeys
    )
  )
  const directSkuMatches = partNumbers.filter((row) => {
    const partNumber = normalizeFishbowlPartNumber(row.part_number)
    return !partNumber.isBlank && partNumber.matchKeys.some((key) => normalizedProductCodes.has(key))
  }).length
  const matchDenominator = Math.min(sfProductsWithCode.count, inventoryWithPartNumber.count)
  const targetMarginPct = toNumber(activePricingRule?.target_margin_pct)
  const minimumMarginPct = toNumber(activePricingRule?.minimum_margin_pct)
  const sampleCostBasis = 100
  const suggestedRetailPrice = calculateSuggestedRetailPrice(sampleCostBasis, targetMarginPct, 2)
  const minimumQuotePrice = calculateMinimumQuotePrice(sampleCostBasis, minimumMarginPct, 2)
  const formulaProbe = evaluatePricingGuardrails({
    productId: 'readiness-probe',
    contractUnitPrice: suggestedRetailPrice,
    costBasis: sampleCostBasis,
    quotedUnitPrice: suggestedRetailPrice,
    minimumMarginPct,
    currency: 'USD',
    expectedCurrency: 'USD',
    uom: 'Each',
    expectedUom: 'Each',
  })

  const checks: ReadinessCheck[] = [
    {
      key: 'product_identity',
      label: 'Product Identity Crosswalk',
      status:
        productCrosswalkRows.available && productCrosswalkRows.count > 0
          ? 'warning'
          : directSkuMatches > 0
            ? 'blocker'
            : 'blocker',
      message:
        productCrosswalkRows.count > 0
          ? 'Product crosswalk exists, but coverage still needs review before enforcement.'
          : 'No canonical product crosswalk is populated. Direct SKU matching is too low for pricing enforcement.',
      owner: 'Pricing/Data',
      metrics: [
        { key: 'sf_products', label: 'Salesforce products', value: sfProducts.count },
        { key: 'inventory_parts', label: 'Fishbowl inventory rows', value: inventoryParts.count },
        { key: 'direct_sku_matches', label: 'Direct SKU matches', value: directSkuMatches },
        {
          key: 'direct_match_rate',
          label: 'Direct match rate',
          value: percent(directSkuMatches, matchDenominator),
          total: 100,
          unit: 'percent',
        },
        { key: 'crosswalk_rows', label: 'Crosswalk rows', value: productCrosswalkRows.count },
        { key: 'inventory_with_sf_id', label: 'Inventory rows with SF Product2 id', value: inventoryWithSfProductId.count },
      ],
      nextAction: 'Create pricing_products/product_crosswalk and run product matching review.',
    },
    {
      key: 'contract_pricing',
      label: 'Contract Pricing Coverage',
      status: contractLines.available && contractLines.count > 0 ? 'warning' : 'blocker',
      message:
        contractLines.count > 0
          ? 'Contract lines exist; coverage must be measured against active products.'
          : 'No contract price lines exist yet, so Zeus cannot calculate contract-based retail pricing.',
      owner: 'Pricing',
      metrics: [
        { key: 'contract_lines', label: 'Contract price lines', value: contractLines.count },
      ],
      nextAction: 'Import contract price files or connect the contract pricing source.',
    },
    {
      key: 'cogs',
      label: 'COGS / Buy Price Coverage',
      status: cogsRows.available && cogsRows.count > 0 ? 'warning' : 'blocker',
      message:
        cogsRows.count > 0
          ? 'COGS records exist; validate source precedence and freshness.'
          : 'No COGS records exist yet, so margins cannot be trusted.',
      owner: 'Finance/Pricing',
      metrics: [
        { key: 'cogs_rows', label: 'COGS records', value: cogsRows.count },
      ],
      nextAction: 'Confirm cost source and load product_cogs history.',
    },
    {
      key: 'fishbowl_quote_lines',
      label: 'Fishbowl Quote/Order Line Coverage',
      status: fbSalesOrderItems.count > 0 ? 'warning' : 'blocker',
      message:
        fbSalesOrderItems.count > 0
          ? 'Fishbowl SO line rows exist; evaluate pricing source and mapping coverage.'
          : 'Fishbowl sales order line cache is empty, so quote/order margin cannot be evaluated.',
      owner: 'Operations',
      metrics: [
        { key: 'fb_sales_order_items', label: 'Fishbowl SO line rows', value: fbSalesOrderItems.count },
      ],
      nextAction: 'Unpause/run P7 Fishbowl Sales Orders sync and verify line items populate.',
    },
    {
      key: 'salesforce_line_items',
      label: 'Salesforce Sales Line Coverage',
      status: opportunityLinesWithProductCode.count === opportunityLines.count && opportunityLines.count > 0
        ? 'ready'
        : 'warning',
      message:
        opportunityLines.count > 0
          ? 'Salesforce line items have sell prices, but product-code coverage is incomplete in the cache.'
          : 'No Salesforce opportunity line items are cached yet.',
      owner: 'Salesforce',
      metrics: [
        { key: 'opportunity_lines', label: 'Opportunity line items', value: opportunityLines.count },
        { key: 'opportunity_lines_with_code', label: 'Lines with product code', value: opportunityLinesWithProductCode.count },
        {
          key: 'opportunity_line_code_rate',
          label: 'Line code coverage',
          value: percent(opportunityLinesWithProductCode.count, opportunityLines.count),
          total: 100,
          unit: 'percent',
        },
      ],
      nextAction: 'Extend Salesforce sync/query or use Product2Id joins so all lines resolve product identity.',
    },
    {
      key: 'pricing_rules',
      label: 'Pricing Rule Coverage',
      status: pricingRules.available && pricingRules.count > 0 ? 'warning' : 'coming_soon',
      message:
        pricingRules.count > 0
          ? 'Pricing rules exist; validate target/minimum margin thresholds.'
          : 'No pricing rules exist yet. Suggested retail and floor formulas need configured thresholds.',
      owner: 'Pricing',
      metrics: [
        { key: 'pricing_rules', label: 'Pricing rules', value: pricingRules.count },
      ],
      nextAction: 'Define target margin and minimum margin by product family/category.',
    },
    {
      key: 'pricing_formula_engine',
      label: 'Pricing Formula Engine',
      status: activePricingRule && formulaProbe.primaryOutcome === 'ready' ? 'ready' : 'coming_soon',
      message:
        activePricingRule && formulaProbe.primaryOutcome === 'ready'
          ? 'Pricing formulas can calculate suggested retail, minimum quote price, margin, and below-floor outcomes from the active rule.'
          : 'Pricing formulas are implemented, but no active pricing rule is available for live calculations.',
      owner: 'Pricing/Data',
      metrics: [
        { key: 'sample_cost_basis', label: 'Sample cost basis', value: sampleCostBasis },
        { key: 'sample_suggested_retail', label: 'Suggested retail probe', value: suggestedRetailPrice ?? 0 },
        { key: 'sample_minimum_quote', label: 'Minimum quote probe', value: minimumQuotePrice ?? 0 },
        { key: 'active_pricing_rules', label: 'Active pricing rules', value: activePricingRule ? 1 : 0 },
      ],
      nextAction: activePricingRule
        ? 'Connect calculator inputs to contract pricing, COGS, and quote line records.'
        : 'Create or enable a pricing rule before showing live calculator outputs.',
    },
  ]

  const status = overallStatus(checks)

  return {
    generatedAt: new Date().toISOString(),
    overallStatus: status,
    summary: {
      checks: checks.length,
      ready: checks.filter((check) => check.status === 'ready').length,
      warnings: checks.filter((check) => check.status === 'warning').length,
      blockers: checks.filter((check) => check.status === 'blocker').length,
      comingSoon: checks.filter((check) => check.status === 'coming_soon').length,
    },
    checks,
  }
}
