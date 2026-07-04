import { inngest } from '../client'
import { buildWeeklyDigest, postSlackMessage } from '@/lib/incentive/digest'
import { generateAndStoreCeoBriefing } from '@/lib/incentive/briefing'

// Push-side comms for the Q3 incentive (Steven, 2026-07-04):
//  - Monday-morning Slack digest per rep (gate status + expiring windows)
//  - Daily CEO briefing stored for the main dashboard card
// TODO(#19): add email delivery for the digest once the program is live.

export const incentiveWeeklyDigest = inngest.createFunction(
  {
    id: 'incentive-weekly-digest',
    name: 'P8: Incentive Weekly Digest (Slack)',
    retries: 2,
    triggers: [{ cron: '0 13 * * 1' }], // Mondays 13:00 UTC = 8am Chicago (CDT)
  },
  async ({ step }) => {
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
    const briefing = await step.run('generate', () => generateAndStoreCeoBriefing())
    return { date: briefing.date, source: briefing.source, chars: briefing.text.length }
  }
)
