// Pure America/Chicago date helpers for the incentive layer. All incentive
// month/period boundaries are Chicago-local (PRD acceptance criterion); the
// SQL side uses AT TIME ZONE 'America/Chicago', and these helpers mirror
// that for the few places the app must compute the same boundaries.

const CHICAGO_TZ = 'America/Chicago'

/** UTC offset (minutes east of UTC, e.g. -300 for CDT) at an exact instant. */
function chicagoOffsetMinutesAt(probe: Date): number {
  const tzName = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    timeZoneName: 'longOffset',
  })
    .formatToParts(probe)
    .find((part) => part.type === 'timeZoneName')?.value
  const match = tzName?.match(/GMT([+-])(\d{2}):(\d{2})/)
  if (!match) return -360 // CST fallback; never expected with a real Intl impl
  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3]))
}

/** The UTC instant of midnight America/Chicago on the given YYYY-MM-DD. */
export function chicagoMidnightUtc(isoDate: string): Date {
  const localClockAsUtc = new Date(`${isoDate}T00:00:00Z`).getTime()
  // Resolve the offset at the candidate instant, not at noon. This matters on
  // the fall-back date: Chicago midnight is still CDT even though noon is CST.
  let candidate = localClockAsUtc
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next =
      localClockAsUtc - chicagoOffsetMinutesAt(new Date(candidate)) * 60_000
    if (next === candidate) break
    candidate = next
  }
  return new Date(candidate)
}

/** Exclusive end bound: midnight Chicago of the day AFTER the given date. */
export function chicagoNextMidnightUtc(isoDate: string): Date {
  const next = new Date(`${isoDate}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return chicagoMidnightUtc(next.toISOString().slice(0, 10))
}

/** YYYY-MM-01 for the Chicago-local month containing the given instant. */
export function chicagoMonthStart(instant: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
  }).format(instant)
  return `${parts.replace('/', '-')}-01`
}

/**
 * The month (YYYY-MM-01) whose payout snapshot is due for auto-freeze:
 * the previous Chicago month, but only once `freezeAfterDays` full days
 * have elapsed since that month ended (grace period for late credits and
 * issue dates). Null while still inside the grace period.
 */
export function autoFreezeTargetMonth(now: Date = new Date(), freezeAfterDays = 7): string | null {
  const currentMonthStart = chicagoMonthStart(now)
  const monthEndUtc = chicagoMidnightUtc(currentMonthStart)
  const graceEndsUtc = new Date(monthEndUtc.getTime() + freezeAfterDays * 86_400_000)
  if (now < graceEndsUtc) return null

  const prev = new Date(`${currentMonthStart}T00:00:00Z`)
  prev.setUTCMonth(prev.getUTCMonth() - 1)
  return prev.toISOString().slice(0, 10)
}
