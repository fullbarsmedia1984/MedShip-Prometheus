import 'server-only'
import { getIncentiveSettings } from './settings'
import { chicagoMonthStart } from './dates'
import { formatUsd } from './calculator'
import { getRepIncentiveMonthly, getRepNewAccounts } from './queries'
import type { IncentiveSettings, RepIncentiveMonthlyRow, RepNewAccount } from './types'

// Weekly rep digest, posted to Slack (Steven, 2026-07-04): gate status per
// rep, what one more enrollment is worth, and which new-customer windows are
// about to close. Push beats pull — reps don't open dashboards.
// TODO(#19): add per-rep email delivery once the program is live.

const EXPIRY_HORIZON_DAYS = 21

export async function postSlackMessage(text: string): Promise<{ sent: boolean; error?: string }> {
  const webhookUrl = process.env.INCENTIVE_DIGEST_WEBHOOK_URL ?? process.env.INCENTIVE_BELL_WEBHOOK_URL
  if (!webhookUrl) return { sent: false, error: 'No Slack webhook configured (INCENTIVE_DIGEST_WEBHOOK_URL / INCENTIVE_BELL_WEBHOOK_URL)' }
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!response.ok) return { sent: false, error: `HTTP ${response.status}: ${await response.text()}` }
    return { sent: true }
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function daysLeftInMonth(now: Date): number {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000))
}

function repSection(
  row: RepIncentiveMonthlyRow,
  accounts: RepNewAccount[],
  settings: IncentiveSettings
): string {
  const name = row.rep_display_name ?? row.rep_key
  const gate = row.qualifies
    ? `✅ ${row.enrollments}/${row.enrollment_gate} enrollments — bonus UNLOCKED`
    : `${row.enrollments}/${row.enrollment_gate} enrollments — ${row.enrollment_gate - row.enrollments} more unlocks ${(settings.bonusRate * 100).toFixed(0)}% on all new-customer revenue`
  const lines = [`*${name}* — ${gate} · new-customer revenue ${formatUsd(row.net_new_customer_revenue)}`]

  const closing = accounts
    .filter((account) => account.daysLeft > 0 && account.daysLeft <= EXPIRY_HORIZON_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 4)
  for (const account of closing) {
    lines.push(
      `    ⏳ ${account.institution ?? account.canonicalKey} — window closes in ${account.daysLeft}d (${formatUsd(account.revenueInWindow)} so far; sales inside the window earn the bonus)`
    )
  }
  return lines.join('\n')
}

export async function buildWeeklyDigest(): Promise<string> {
  const settings = await getIncentiveSettings()
  const month = chicagoMonthStart()
  const rows = await getRepIncentiveMonthly(month)
  const now = new Date()
  const monthName = new Date(`${month}T00:00:00`).toLocaleDateString('en-US', { month: 'long' })

  const repRows = rows.sort((a, b) => b.enrollments - a.enrollments || b.net_new_customer_revenue - a.net_new_customer_revenue)
  const sections: string[] = []
  for (const row of repRows) {
    const accounts = await getRepNewAccounts(row.rep_key, settings)
    sections.push(repSection(row, accounts, settings))
  }

  const teamEnrollments = repRows.reduce((sum, row) => sum + row.enrollments, 0)
  const teamNeeded = settings.enrollmentGate * Math.max(repRows.length, 1)

  const header = `📊 *Q3 Incentive — Weekly Digest* · ${monthName} · ${daysLeftInMonth(now)} days left in the month`
  const footer =
    `Team pace: ${teamEnrollments} enrollment${teamEnrollments === 1 ? '' : 's'} so far vs ${teamNeeded} needed for everyone to qualify. ` +
    `Scorecards: /dashboard/incentives/scorecard`

  return [header, ...sections, footer].join('\n\n')
}
