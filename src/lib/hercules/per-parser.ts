export type ParsedPer = {
  rawPerText: string | null
  parsedPerQuantity: number | null
  parsedPerUom: string | null
}

export function parsePerText(value: unknown): ParsedPer {
  if (value === null || value === undefined) {
    return {
      rawPerText: null,
      parsedPerQuantity: null,
      parsedPerUom: null,
    }
  }

  const rawPerText = String(value).trim()
  if (!rawPerText) {
    return {
      rawPerText: null,
      parsedPerQuantity: null,
      parsedPerUom: null,
    }
  }

  const match = rawPerText.match(/^(\d+(?:\.\d+)?)\s*\/\s*([A-Za-z0-9_-]+)$/)
  if (!match) {
    return {
      rawPerText,
      parsedPerQuantity: null,
      parsedPerUom: null,
    }
  }

  const quantity = Number(match[1])
  return {
    rawPerText,
    parsedPerQuantity: Number.isFinite(quantity) ? quantity : null,
    parsedPerUom: match[2].toUpperCase(),
  }
}
