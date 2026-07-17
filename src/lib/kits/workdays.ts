// Workday math matching the warehouse workbook's WORKDAY() formulas.
// Dates are handled as 'YYYY-MM-DD' strings in local terms (no TZ math).

function toDate(iso: string): Date {
  return new Date(iso + 'T12:00:00')
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

/** Excel WORKDAY(start, days): skips Sat/Sun; negative days go backward. */
export function addWorkdays(startIso: string, days: number): string {
  const d = toDate(startIso)
  const step = days < 0 ? -1 : 1
  let remaining = Math.abs(days)
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + step)
    if (!isWeekend(d)) remaining--
  }
  return toIso(d)
}

/** Whole workdays between two dates (exclusive of start, inclusive of end).
 *  Negative when end precedes start. */
export function workdaysBetween(startIso: string, endIso: string): number {
  if (endIso < startIso) return -workdaysBetween(endIso, startIso)
  const d = toDate(startIso)
  const end = toIso(toDate(endIso))
  let count = 0
  while (toIso(d) < end) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (!isWeekend(d)) count++
  }
  return count
}

/** The workbook's ship deadline: need-by minus transit, in workdays,
 *  landing on a workday (mirrors =WORKDAY(WORKDAY(needBy-1,1),-transit)). */
export function shipDeadline(needByIso: string, transitDays: number): string {
  return addWorkdays(needByIso, -Math.max(transitDays, 0))
}
