import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { getIncentiveSettings } from './settings'
import { chicagoMonthStart } from './dates'
import { formatUsd } from './calculator'
import { getRepIncentiveMonthly } from './queries'

// Daily CEO briefing (Steven, 2026-07-04): a short generated note on the main
// dashboard telling Dan what deserves concern or congratulations today —
// gate pace vs calibration, new enrollments, expiring windows, blockers.
// Written by Claude Haiku via OpenRouter with a deterministic fallback.

export const CEO_BRIEFING_SETTINGS_KEY = 'ceo_daily_briefing'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_MODEL = 'anthropic/claude-haiku-4.5'

export interface BriefingMetrics {
  date: string // YYYY-MM-DD (Chicago)
  month: string
  daysLeftInMonth: number
  reps: Array<{ name: string; enrollments: number; gate: number; qualifies: boolean; newRevenue: number }>
  teamEnrollments: number
  teamNeededForFullQualification: number
  bellsRungLast24h: number
  windowsExpiring14d: number
  payoutBlockedReps: number
  inPromoPeriod: boolean
}

export interface CeoBriefing {
  date: string
  text: string
  source: 'ai' | 'fallback'
  metrics: BriefingMetrics
  generatedAt: string
}

function chicagoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

export async function gatherBriefingMetrics(): Promise<BriefingMetrics> {
  const supabase = createAdminClient()
  const settings = await getIncentiveSettings()
  const month = chicagoMonthStart()
  const rows = await getRepIncentiveMonthly(month)

  const [{ count: bells }, { count: expiring }] = await Promise.all([
    supabase
      .from('incentive_bell_log')
      .select('canonical_key', { count: 'exact', head: true })
      .gte('rung_at', new Date(Date.now() - 86_400_000).toISOString()),
    supabase
      .from('customer_first_order')
      .select('canonical_customer_key', { count: 'exact', head: true })
      .gt('new_window_end', new Date().toISOString())
      .lt('new_window_end', new Date(Date.now() + 14 * 86_400_000).toISOString()),
  ])

  const now = new Date()
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  return {
    date: chicagoToday(),
    month,
    daysLeftInMonth: Math.max(0, Math.ceil((monthEnd.getTime() - now.getTime()) / 86_400_000)),
    reps: rows.map((row) => ({
      name: row.rep_display_name ?? row.rep_key,
      enrollments: row.enrollments,
      gate: row.enrollment_gate,
      qualifies: row.qualifies,
      newRevenue: row.net_new_customer_revenue,
    })),
    teamEnrollments: rows.reduce((sum, row) => sum + row.enrollments, 0),
    teamNeededForFullQualification: settings.enrollmentGate * Math.max(rows.length, 1),
    bellsRungLast24h: bells ?? 0,
    windowsExpiring14d: expiring ?? 0,
    payoutBlockedReps: rows.filter((row) => row.blocking_unmapped_count > 0).length,
    inPromoPeriod:
      month >= `${settings.promoStart.slice(0, 7)}-01` && month <= `${settings.promoEnd.slice(0, 7)}-01`,
  }
}

export function buildFallbackBriefing(metrics: BriefingMetrics): string {
  const parts: string[] = []
  const pace = metrics.teamEnrollments / Math.max(metrics.teamNeededForFullQualification, 1)

  if (metrics.bellsRungLast24h > 0) {
    parts.push(`🔔 ${metrics.bellsRungLast24h} new account${metrics.bellsRungLast24h === 1 ? '' : 's'} enrolled in the last 24h.`)
  }
  const qualified = metrics.reps.filter((rep) => rep.qualifies).map((rep) => rep.name)
  if (qualified.length > 0) parts.push(`${qualified.join(' and ')} ${qualified.length === 1 ? 'has' : 'have'} cleared the enrollment gate — worth a shout-out.`)

  if (metrics.inPromoPeriod && pace < 0.5 && metrics.daysLeftInMonth <= 20) {
    parts.push(
      `⚠️ Gate pace concern: ${metrics.teamEnrollments} team enrollments vs ${metrics.teamNeededForFullQualification} needed with ${metrics.daysLeftInMonth} days left. If this holds, consider whether the gate needs calibration.`
    )
  }
  if (metrics.windowsExpiring14d > 0) {
    parts.push(`${metrics.windowsExpiring14d} new-customer window${metrics.windowsExpiring14d === 1 ? '' : 's'} close within 14 days — follow-up orders inside the window still earn the bonus.`)
  }
  if (metrics.payoutBlockedReps > 0) {
    parts.push(`⚠️ ${metrics.payoutBlockedReps} rep row${metrics.payoutBlockedReps === 1 ? '' : 's'} payout-blocked by unmapped salespersons — resolve in the incentive admin.`)
  }
  if (parts.length === 0) {
    const top = [...metrics.reps].sort((a, b) => b.newRevenue - a.newRevenue)[0]
    parts.push(
      top && top.newRevenue > 0
        ? `Quiet day. ${top.name} leads on new-customer revenue (${formatUsd(top.newRevenue)}); team is ${metrics.teamEnrollments}/${metrics.teamNeededForFullQualification} on the gate with ${metrics.daysLeftInMonth} days left.`
        : `Quiet day — no new enrollments yet this month; ${metrics.daysLeftInMonth} days left.`
    )
  }
  return parts.join(' ')
}

async function fetchHaikuBriefing(metrics: BriefingMetrics): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  const system =
    'You write a 2-4 sentence daily briefing for the CEO of MedShip about the Q3 new-customer sales incentive. ' +
    'Input is JSON with per-rep enrollment-gate progress, team pace vs the number needed for everyone to qualify, ' +
    'bells rung (new accounts) in the last 24h, new-customer windows expiring within 14 days, and payout blockers. ' +
    'Lead with the single most important thing today: congratulations when reps clear the gate or new accounts land, ' +
    'concern when pace makes the gate unreachable (suggest a calibration look, never a specific new number), ' +
    'or operational blockers. Be specific with names and figures from the JSON only — never invent numbers. ' +
    'No greeting, no preamble, no emoji, plain text.'

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        max_tokens: 300,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(metrics) },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) return null
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> }
    const text = payload.choices?.[0]?.message?.content?.trim()
    return text && text.length > 0 ? text : null
  } catch {
    return null
  }
}

export async function generateAndStoreCeoBriefing(): Promise<CeoBriefing> {
  const metrics = await gatherBriefingMetrics()
  const aiText = await fetchHaikuBriefing(metrics)
  const briefing: CeoBriefing = {
    date: metrics.date,
    text: aiText ?? buildFallbackBriefing(metrics),
    source: aiText ? 'ai' : 'fallback',
    metrics,
    generatedAt: new Date().toISOString(),
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from('app_settings').upsert({
    key: CEO_BRIEFING_SETTINGS_KEY,
    value: briefing as unknown as Record<string, unknown>,
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
  return briefing
}

export async function getLatestCeoBriefing(): Promise<CeoBriefing | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', CEO_BRIEFING_SETTINGS_KEY)
    .maybeSingle()
  if (error) throw error
  return (data?.value as CeoBriefing | undefined) ?? null
}
