type QualityInput = {
  soNumber: string
  status: string
  customerName?: string | null
  salesperson?: string | null
  amount?: number | null
  subtotalAmount?: number | null
  dateCreated?: string | null
  lineCount?: number
  lineTotal?: number
}

const STALE_QUOTE_DAYS = 365
const TEST_RECORD_PATTERN = /(^|\b)(test|testing|do not use|sample|warehouse)/i

function daysSince(dateValue?: string | null): number | null {
  if (!dateValue) return null
  const time = new Date(dateValue).getTime()
  if (!Number.isFinite(time)) return null
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000))
}

function hasTestMarker(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => Boolean(value && TEST_RECORD_PATTERN.test(value)))
}

export function classifySalesOrder(statusValue: unknown): 'quote' | 'order' | 'void' | 'unknown' {
  const status = String(statusValue ?? '').trim().toLowerCase()
  if (!status) return 'unknown'
  if (['issued', 'in progress', 'partial', 'fulfilled', 'completed', 'closed'].includes(status)) {
    return 'order'
  }
  if (['void', 'voided', 'cancelled', 'canceled', 'deleted'].includes(status)) {
    return 'void'
  }
  if (['estimate', 'expired', 'closed short', 'accepted', 'sent', 'viewed', 'rejected'].includes(status)) {
    return 'quote'
  }
  return 'unknown'
}

export function getSalesOrderQualityFlags(input: QualityInput): string[] {
  const flags = new Set<string>()
  const amount = Number(input.amount ?? input.subtotalAmount ?? 0)
  const lineCount = input.lineCount ?? 0
  const lineTotal = Number(input.lineTotal ?? 0)
  const canonicalState = classifySalesOrder(input.status)

  if (hasTestMarker(input.soNumber, input.customerName, input.salesperson)) {
    flags.add('likely_test')
  }
  if (lineCount === 0) {
    flags.add('missing_line_items')
  }
  if (amount <= 0) {
    flags.add('zero_value')
  }
  if (daysSince(input.dateCreated) !== null && Number(daysSince(input.dateCreated)) > STALE_QUOTE_DAYS) {
    flags.add('historical')
  }
  if (lineCount > 0 && amount > 0 && Math.abs(amount - lineTotal) > 1) {
    flags.add('line_total_mismatch')
  }
  if (canonicalState === 'unknown') {
    flags.add('unknown_state')
  }

  return [...flags]
}
