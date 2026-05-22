import type {
  HerculesContractPriceStatus,
  HerculesCostIneligibilityReason,
  PriceParseResult,
} from './types'

const REQUEST_QUOTE_PATTERN = /request\s+quote|quote\s+required/i
const LIST_ONLY_PATTERN = /list\s+only/i
const NOT_PROVIDED_PATTERN = /^(not\s+provided|n\/a|na|none|null)$/i

function rawText(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text || null
}

export function parseMoneyAmount(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  const text = rawText(value)
  if (!text) return null

  const normalized = text.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null

  const amount = Number(normalized)
  return Number.isFinite(amount) ? amount : null
}

export function parseContractPrice(
  value: string | number | null | undefined
): PriceParseResult {
  const text = rawText(value)

  if (!text || NOT_PROVIDED_PATTERN.test(text)) {
    return {
      amount: null,
      status: 'not_provided',
      rawText: text,
    }
  }

  if (LIST_ONLY_PATTERN.test(text) && REQUEST_QUOTE_PATTERN.test(text)) {
    return {
      amount: null,
      status: 'list_only_request_quote',
      rawText: text,
    }
  }

  if (LIST_ONLY_PATTERN.test(text)) {
    return {
      amount: null,
      status: 'list_only',
      rawText: text,
    }
  }

  const amount = parseMoneyAmount(value)
  if (amount !== null) {
    return {
      amount,
      status: 'contract_available',
      rawText: text,
    }
  }

  return {
    amount: null,
    status: 'parse_error',
    rawText: text,
  }
}

export function contractPriceIneligibilityReason(
  status: HerculesContractPriceStatus
): HerculesCostIneligibilityReason | null {
  switch (status) {
    case 'contract_available':
      return null
    case 'list_only_request_quote':
      return 'contract_price_requires_quote'
    case 'list_only':
      return 'contract_price_list_only'
    case 'not_provided':
      return 'contract_price_not_provided'
    case 'parse_error':
      return 'contract_price_parse_error'
    default:
      return 'unknown'
  }
}
