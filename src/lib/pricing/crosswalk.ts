import type { NormalizedSku, SkuSource } from './normalization'
import {
  normalizeContractSku,
  normalizeFishbowlPartNumber,
  normalizeSalesforceProductCode,
  normalizeSku,
} from './normalization'

export type ProductIdentitySystem = 'salesforce' | 'fishbowl' | 'contract' | 'pricing' | 'manual' | 'unknown'

export type ProductIdentity = {
  system: ProductIdentitySystem
  id?: string | null
  salesforceProductId?: string | null
  sku?: string | null
  productCode?: string | null
  partNumber?: string | null
  aliases?: readonly (string | null | undefined)[]
  active?: boolean | null
}

export type CrosswalkMatchStatus = 'matched' | 'needs_review' | 'conflict' | 'ignored' | 'inactive'

export type CrosswalkCandidateInput = {
  id?: string | null
  source: ProductIdentity
  target: ProductIdentity
  manualMatch?: boolean
  ignored?: boolean
  inactive?: boolean
}

export type CrosswalkSignal =
  | 'manual_mapping'
  | 'salesforce_product_id'
  | 'normalized_sku'
  | 'compact_sku'
  | 'token_overlap'
  | 'no_match'
  | 'ignored'
  | 'inactive'
  | 'conflicting_target'

export type CrosswalkCandidateScore = CrosswalkCandidateInput & {
  score: number
  status: CrosswalkMatchStatus
  signals: CrosswalkSignal[]
  reasons: string[]
  sourceKey: string
  targetKey: string
}

const MATCHED_SCORE = 80

function textKey(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? ''
}

function unique<T>(values: readonly T[]) {
  return [...new Set(values)]
}

function skuSourceForIdentity(system: ProductIdentitySystem): SkuSource {
  if (system === 'salesforce' || system === 'fishbowl' || system === 'contract') return system
  return 'unknown'
}

function identitySkus(identity: ProductIdentity): NormalizedSku[] {
  const aliases = identity.aliases ?? []
  const skus: NormalizedSku[] = []

  if (identity.productCode) {
    skus.push(normalizeSalesforceProductCode(identity.productCode, aliases))
  }

  if (identity.partNumber) {
    skus.push(normalizeFishbowlPartNumber(identity.partNumber, aliases))
  }

  if (identity.sku) {
    skus.push(
      identity.system === 'contract'
        ? normalizeContractSku(identity.sku, aliases)
        : normalizeSku(identity.sku, {
            source: skuSourceForIdentity(identity.system),
            aliases,
          })
    )
  }

  for (const alias of aliases) {
    if (alias) skus.push(normalizeContractSku(alias))
  }

  return skus.filter((sku) => !sku.isBlank)
}

function identitySkuKeys(identity: ProductIdentity) {
  return unique(identitySkus(identity).flatMap((sku) => sku.matchKeys)).sort()
}

function stableIdentityKey(identity: ProductIdentity) {
  const id = textKey(identity.id)
  if (id) return `${identity.system}:${id}`

  const salesforceProductId = textKey(identity.salesforceProductId)
  if (salesforceProductId) return `salesforce-product:${salesforceProductId}`

  const firstSkuKey = identitySkuKeys(identity)[0]
  if (firstSkuKey) return `${identity.system}:sku:${firstSkuKey}`

  return `${identity.system}:unknown`
}

function sharedValues(left: readonly string[], right: readonly string[]) {
  const rightValues = new Set(right)
  return left.filter((value) => rightValues.has(value))
}

function scoreSkuEvidence(source: ProductIdentity, target: ProductIdentity) {
  const sourceSkus = identitySkus(source)
  const targetSkus = identitySkus(target)
  const sourceNormalized = unique(sourceSkus.map((sku) => sku.normalized).filter(Boolean))
  const targetNormalized = unique(targetSkus.map((sku) => sku.normalized).filter(Boolean))
  const sourceCompact = unique(sourceSkus.map((sku) => sku.compact).filter(Boolean))
  const targetCompact = unique(targetSkus.map((sku) => sku.compact).filter(Boolean))
  const sourceTokens = unique(sourceSkus.flatMap((sku) => sku.tokens))
  const targetTokens = unique(targetSkus.flatMap((sku) => sku.tokens))

  if (sharedValues(sourceNormalized, targetNormalized).length > 0) {
    return {
      score: 88,
      signal: 'normalized_sku' as const,
      reason: 'Normalized SKU or part number matches exactly.',
    }
  }

  if (sharedValues(sourceCompact, targetCompact).length > 0) {
    return {
      score: 80,
      signal: 'compact_sku' as const,
      reason: 'Compact SKU matches after punctuation and spacing are removed.',
    }
  }

  const tokenOverlap = sharedValues(sourceTokens, targetTokens)
  if (tokenOverlap.length >= 2) {
    return {
      score: 55,
      signal: 'token_overlap' as const,
      reason: 'Two or more SKU tokens overlap, but the full SKU does not match.',
    }
  }

  return {
    score: 0,
    signal: 'no_match' as const,
    reason: 'No SKU, ProductCode, part number, alias, or shared product id evidence matched.',
  }
}

export function scoreCrosswalkCandidate(candidate: CrosswalkCandidateInput): CrosswalkCandidateScore {
  const sourceKey = stableIdentityKey(candidate.source)
  const targetKey = stableIdentityKey(candidate.target)

  if (candidate.ignored) {
    return {
      ...candidate,
      score: 0,
      status: 'ignored',
      signals: ['ignored'],
      reasons: ['Candidate was explicitly ignored.'],
      sourceKey,
      targetKey,
    }
  }

  if (candidate.inactive || candidate.source.active === false || candidate.target.active === false) {
    return {
      ...candidate,
      score: 0,
      status: 'inactive',
      signals: ['inactive'],
      reasons: ['Source or target product is inactive.'],
      sourceKey,
      targetKey,
    }
  }

  if (candidate.manualMatch) {
    return {
      ...candidate,
      score: 100,
      status: 'matched',
      signals: ['manual_mapping'],
      reasons: ['Manual mapping selected this product match.'],
      sourceKey,
      targetKey,
    }
  }

  const sourceSalesforceProductId = textKey(candidate.source.salesforceProductId)
  const targetSalesforceProductId = textKey(candidate.target.salesforceProductId)

  if (sourceSalesforceProductId && sourceSalesforceProductId === targetSalesforceProductId) {
    return {
      ...candidate,
      score: 96,
      status: 'matched',
      signals: ['salesforce_product_id'],
      reasons: ['Salesforce Product2 id matches.'],
      sourceKey,
      targetKey,
    }
  }

  const skuEvidence = scoreSkuEvidence(candidate.source, candidate.target)
  const status = skuEvidence.score >= MATCHED_SCORE ? 'matched' : 'needs_review'

  return {
    ...candidate,
    score: skuEvidence.score,
    status,
    signals: [skuEvidence.signal],
    reasons: [skuEvidence.reason],
    sourceKey,
    targetKey,
  }
}

export function classifyCrosswalkCandidates(
  candidates: readonly CrosswalkCandidateInput[]
): CrosswalkCandidateScore[] {
  const scored = candidates.map(scoreCrosswalkCandidate)
  const bySource = new Map<string, CrosswalkCandidateScore[]>()

  for (const candidate of scored) {
    const group = bySource.get(candidate.sourceKey) ?? []
    group.push(candidate)
    bySource.set(candidate.sourceKey, group)
  }

  return scored.map((candidate) => {
    if (candidate.status === 'ignored' || candidate.status === 'inactive') return candidate

    const activeMatches = (bySource.get(candidate.sourceKey) ?? []).filter(
      (groupCandidate) =>
        groupCandidate.status === 'matched' &&
        groupCandidate.score >= MATCHED_SCORE &&
        groupCandidate.targetKey !== candidate.sourceKey
    )
    const distinctTargets = new Set(activeMatches.map((groupCandidate) => groupCandidate.targetKey))

    if (candidate.status === 'matched' && distinctTargets.size > 1) {
      return {
        ...candidate,
        status: 'conflict',
        signals: unique([...candidate.signals, 'conflicting_target']),
        reasons: unique([
          ...candidate.reasons,
          'Multiple matched candidates point this source product at different targets.',
        ]),
      }
    }

    return candidate
  })
}

export function summarizeCrosswalkStatuses(candidates: readonly CrosswalkCandidateScore[]) {
  return candidates.reduce(
    (summary, candidate) => ({
      ...summary,
      [candidate.status]: summary[candidate.status] + 1,
    }),
    {
      matched: 0,
      needs_review: 0,
      conflict: 0,
      ignored: 0,
      inactive: 0,
    } satisfies Record<CrosswalkMatchStatus, number>
  )
}
