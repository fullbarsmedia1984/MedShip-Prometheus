export type SkuSource = 'salesforce' | 'fishbowl' | 'contract' | 'unknown'

export type NormalizedSku = {
  raw: string
  source: SkuSource
  normalized: string
  compact: string
  tokens: string[]
  matchKeys: string[]
  isBlank: boolean
}

export type SkuNormalizationOptions = {
  source?: SkuSource
  removeKnownPrefixes?: boolean
  aliases?: readonly unknown[]
}

const KNOWN_PREFIX_PATTERN =
  /^(?:SKU|PRODUCT\s*CODE|PART\s*(?:NO|NUMBER|#)?|ITEM\s*(?:NO|NUMBER|#)?|MFG\s*(?:PART|SKU)?)\s*[:#-]\s*/i

function textValue(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value)
}

function normalizeSeparators(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[._/\\]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeSkuText(value: unknown, removeKnownPrefixes = false) {
  let normalized = normalizeSeparators(textValue(value))

  if (removeKnownPrefixes) {
    normalized = normalized.replace(KNOWN_PREFIX_PATTERN, '')
  }

  return normalized
    .toUpperCase()
    .replace(/\s*-\s*/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[#:\-\s]+|[#:\-\s]+$/g, '')
}

function compactSkuText(value: string) {
  return value.replace(/[^A-Z0-9]/g, '')
}

function unique(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))]
}

export function normalizeSku(value: unknown, options: SkuNormalizationOptions = {}): NormalizedSku {
  const source = options.source ?? 'unknown'
  const raw = textValue(value)
  const normalized = normalizeSkuText(raw, options.removeKnownPrefixes)
  const compact = compactSkuText(normalized)
  const tokens = unique(normalized.split(/[^A-Z0-9]+/g))

  const aliasKeys = (options.aliases ?? []).flatMap((alias) => {
    const normalizedAlias = normalizeSkuText(alias, true)
    return [normalizedAlias, compactSkuText(normalizedAlias)]
  })

  const matchKeys = unique([normalized, compact, ...aliasKeys])

  return {
    raw,
    source,
    normalized,
    compact,
    tokens,
    matchKeys,
    isBlank: compact.length === 0,
  }
}

export function normalizeSalesforceProductCode(productCode: unknown, aliases: readonly unknown[] = []) {
  return normalizeSku(productCode, {
    source: 'salesforce',
    aliases,
  })
}

export function normalizeFishbowlPartNumber(partNumber: unknown, aliases: readonly unknown[] = []) {
  return normalizeSku(partNumber, {
    source: 'fishbowl',
    aliases,
  })
}

export function normalizeContractSku(contractSku: unknown, aliases: readonly unknown[] = []) {
  return normalizeSku(contractSku, {
    source: 'contract',
    removeKnownPrefixes: true,
    aliases,
  })
}

export function getSkuMatchKeys(...values: readonly NormalizedSku[]) {
  return unique(values.flatMap((value) => value.matchKeys))
}

export function skuKeysIntersect(left: NormalizedSku, right: NormalizedSku) {
  if (left.isBlank || right.isBlank) return false
  const rightKeys = new Set(right.matchKeys)
  return left.matchKeys.some((key) => rightKeys.has(key))
}
