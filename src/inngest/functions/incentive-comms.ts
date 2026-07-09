import { inngest } from '../client'
import { buildWeeklyDigest, postSlackMessage } from '@/lib/incentive/digest'
import { generateAndStoreCeoBriefing } from '@/lib/incentive/briefing'
import { chicagoTodayIso, isBusinessDay, nonBusinessDayReason } from '@/lib/business-days'

// Push-side comms for the Q3 incentive (Steven, 2026-07-04):
//  - Monday-morning Slack digest per rep (gate status + expiring windows)
//  - Daily CEO briefing stored for the main dashboard card
// Business-day policy (Steven, 2026-07-04): Mon-Fri excl. major US holidays.
// No generated reporting/commentary on weekends or holidays — the briefing
// skips those days (the prior business day's note stays on the dashboard),
// and a holiday Monday shifts the digest to Tuesday.
// TODO(#19): add email delivery for the digest once the program is live.

const DAY_MS = 86_400_000

export const incentiveWeeklyDigest = inngest.createFunction(
  {
    id: 'incentive-weekly-digest',
    name: 'P8: Incentive Weekly Digest (Slack)',
    retries: 2,
    // Monday 8am Chicago normally; the Tuesday trigger exists only to catch
    // weeks whose Monday is a holiday (e.g. Labor Day lands inside Q3).
    triggers: [{ cron: '0 13 * * 1' }, { cron: '0 13 * * 2' }],
  },
  async ({ step }) => {
    const today = chicagoTodayIso()
    const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay()

    if (dayOfWeek === 1 && !isBusinessDay(today)) {
      return { skipped: true, reason: `Monday ${today} is a holiday; digest shifts to Tuesday` }
    }
    if (dayOfWeek === 2) {
      const monday = new Date(new Date(`${today}T00:00:00Z`).getTime() - DAY_MS).toISOString().slice(0, 10)
      if (isBusinessDay(monday)) {
        return { skipped: true, reason: 'Tuesday run only fires when Monday was a holiday' }
      }
    }

    const text = await step.run('build', () => buildWeeklyDigest())
    const result = await step.run('post', () => postSlackMessage(text))
    return { ...result, length: text.length }
  }
)

export const ceoDailyBriefing = inngest.createFunction(
  {
    id: 'ceo-daily-briefing',
    name: 'P8: CEO Daily Briefing',
    retries: 2,
    triggers: [{ cron: '0 12 * * *' }], // daily 12:00 UTC = 7am Chicago (CDT)
  },
  async ({ step }) => {
    const today = chicagoTodayIso()
    const reason = nonBusinessDayReason(today)
    if (reason) {
      // No weekend/holiday commentary — Friday's briefing stays up.
      return { skipped: true, date: today, reason }
    }

    const briefing = await step.run('generate', () => generateAndStoreCeoBriefing())
    return { date: briefing.date, source: briefing.source, chars: briefing.text.length }
  }
)
