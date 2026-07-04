// Business-day calendar (Steven, 2026-07-04): business days are Monday
// through Friday, excluding major US holidays. Reporting and generated
// commentary (CEO briefing, weekly digest) skip non-business days, and
// pace math counts selling days rather than calendar days.
//
// Holidays are computed by rule (not a hardcoded year list) and use the
// observed date when they fall on a weekend (Sat -> Fri, Sun -> Mon).

const DAY_MS = 86_400_000

function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function weekday(iso: string): number {
  return toUtcDate(iso).getUTCDay() // 0 = Sunday … 6 = Saturday
}

/** Today's calendar date in America/Chicago as YYYY-MM-DD. */
export function chicagoTodayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now)
}

function nthWeekdayOfMonth(year: number, month: number, dayOfWeek: number, n: number): string {
  const first = new Date(Date.UTC(year, month, 1))
  const offset = (dayOfWeek - first.getUTCDay() + 7) % 7
  return toIso(new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7)))
}

function lastWeekdayOfMonth(year: number, month: number, dayOfWeek: number): string {
  const last = new Date(Date.UTC(year, month + 1, 0))
  const offset = (last.getUTCDay() - dayOfWeek + 7) % 7
  return toIso(new Date(last.getTime() - offset * DAY_MS))
}

/** Shift a fixed-date holiday to its observed business date. */
function observed(iso: string): string {
  const day = weekday(iso)
  if (day === 6) return toIso(new Date(toUtcDate(iso).getTime() - DAY_MS)) // Sat -> Fri
  if (day === 0) return toIso(new Date(toUtcDate(iso).getTime() + DAY_MS)) // Sun -> Mon
  return iso
}

const holidayCache = new Map<number, Set<string>>()

/** Observed major US holidays for a year (federal set + day after Thanksgiving). */
export function usHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year)
  if (cached) return cached

  const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4)
  const holidays = new Set<string>([
    observed(`${year}-01-01`),                    // New Year's Day
    nthWeekdayOfMonth(year, 0, 1, 3),             // MLK Day (3rd Mon Jan)
    nthWeekdayOfMonth(year, 1, 1, 3),             // Presidents' Day (3rd Mon Feb)
    lastWeekdayOfMonth(year, 4, 1),               // Memorial Day (last Mon May)
    observed(`${year}-06-19`),                    // Juneteenth
    observed(`${year}-07-04`),                    // Independence Day
    nthWeekdayOfMonth(year, 8, 1, 1),             // Labor Day (1st Mon Sep)
    observed(`${year}-11-11`),                    // Veterans Day
    thanksgiving,                                 // Thanksgiving (4th Thu Nov)
    toIso(new Date(toUtcDate(thanksgiving).getTime() + DAY_MS)), // day after
    observed(`${year}-12-25`),                    // Christmas
  ])
  holidayCache.set(year, holidays)
  return holidays
}

export function isWeekend(iso: string): boolean {
  const day = weekday(iso)
  return day === 0 || day === 6
}

export function isHoliday(iso: string): boolean {
  return usHolidays(Number(iso.slice(0, 4))).has(iso)
}

export function isBusinessDay(iso: string): boolean {
  return !isWeekend(iso) && !isHoliday(iso)
}

/** Why a date is not a business day, for skip logs. */
export function nonBusinessDayReason(iso: string): 'weekend' | 'holiday' | null {
  if (isWeekend(iso)) return 'weekend'
  if (isHoliday(iso)) return 'holiday'
  return null
}

/** Business days remaining in the month of `iso`, counting `iso` itself. */
export function businessDaysLeftInMonth(iso: string): number {
  const [year, month] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1]
  const end = new Date(Date.UTC(year, month + 1, 1))
  let count = 0
  for (let cursor = toUtcDate(iso); cursor < end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    if (isBusinessDay(toIso(cursor))) count++
  }
  return count
}
