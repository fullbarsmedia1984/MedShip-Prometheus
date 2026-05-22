import { createHash } from 'node:crypto'

function normalizeIdentityPart(value: unknown) {
  if (value === null || value === undefined || value === '') return 'NULL'
  return String(value).trim().toUpperCase()
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)])
    )
  }
  return value
}

export function hashParts(prefix: string, parts: readonly unknown[]) {
  const identity = parts.map(normalizeIdentityPart).join('|')
  const hash = createHash('sha256').update(identity).digest('hex')
  return `${prefix}:${hash}`
}

export function hashPayload(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
}
