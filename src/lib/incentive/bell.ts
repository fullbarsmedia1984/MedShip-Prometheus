import { createAdminClient } from '@/lib/supabase/admin'
import { sendAlertEmail } from '@/lib/utils/notifications'
import { chicagoMidnightUtc, chicagoNextMidnightUtc } from './dates'
import { formatUsd } from './calculator'
import type { IncentiveSettings } from './types'

// "Ring the bell": fires exactly once per canonical customer, on their first
// completed order inside the promo period. Dedupe is the incentive_bell_log
// PRIMARY KEY — insert-first with ignoreDuplicates makes ringing race-safe
// across overlapping Inngest runs; the webhook only fires when the insert
// actually wrote a row.

export type BellCandidate = {
  canonicalKey: string
  soNumber: string
  rep: string
  institution: string
  amount: number
}

export function buildBellMessage(candidate: BellCandidate): string {
  return `🔔 New account enrolled: ${candidate.institution} — first order SO ${candidate.soNumber} for ${formatUsd(candidate.amount)} by ${candidate.rep}`
}

export async function sendIncentiveBellWebhook(
  candidate: BellCandidate
): Promise<{ sent: boolean; provider: string; error?: string }> {
  const webhookUrl = process.env.INCENTIVE_BELL_WEBHOOK_URL
  const text = buildBellMessage(candidate)

  if (webhookUrl) {
    try {
      // { text } is the payload shape both Slack incoming webhooks and
      // Teams incoming webhooks/workflows accept.
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!response.ok) {
        return {
          sent: false,
          provider: 'incentive-webhook',
          error: `Bell webhook returned HTTP ${response.status}: ${await response.text()}`,
        }
      }
      return { sent: true, provider: 'incentive-webhook' }
    } catch (error) {
      return {
        sent: false,
        provider: 'incentive-webhook',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return sendAlertEmail({
    subject: `[Prometheus] New account enrolled: ${candidate.institution}`,
    text,
  })
}

export async function findUnrungEnrollments(settings: IncentiveSettings): Promise<BellCandidate[]> {
  const supabase = createAdminClient()
  const promoStart = chicagoMidnightUtc(settings.promoStart).toISOString()
  const promoEndExclusive = chicagoNextMidnightUtc(settings.promoEnd).toISOString()

  const { data: firstOrders, error } = await supabase
    .from('v_incentive_order_detail')
    .select('so_number, canonical_customer_key, customer_name, rep_display_name, salesperson_raw, net_amount')
    .eq('is_first_order', true)
    .eq('class', 'NEW_WINDOW')
    .gte('order_at', promoStart)
    .lt('order_at', promoEndExclusive)
    .limit(2000)
  if (error) throw error

  const candidates = (firstOrders ?? []).filter((row) => row.canonical_customer_key)
  if (candidates.length === 0) return []

  const keys = candidates.map((row) => row.canonical_customer_key as string)
  const { data: rung, error: rungError } = await supabase
    .from('incentive_bell_log')
    .select('canonical_key')
    .in('canonical_key', keys)
  if (rungError) throw rungError

  const alreadyRung = new Set((rung ?? []).map((row) => row.canonical_key as string))
  return candidates
    .filter((row) => !alreadyRung.has(row.canonical_customer_key as string))
    .map((row) => ({
      canonicalKey: row.canonical_customer_key as string,
      soNumber: String(row.so_number),
      rep: (row.rep_display_name as string | null) ?? (row.salesperson_raw as string | null) ?? 'Unknown rep',
      institution: (row.customer_name as string | null) ?? 'Unknown account',
      amount: Number(row.net_amount) || 0,
    }))
}

export async function ringBell(
  candidate: BellCandidate
): Promise<{ rung: boolean; webhook: { sent: boolean; provider: string; error?: string } | null }> {
  const supabase = createAdminClient()

  // Insert first; if another run already rang this customer, the conflict
  // returns zero rows and we skip the webhook entirely.
  const { data: inserted, error } = await supabase
    .from('incentive_bell_log')
    .upsert(
      {
        canonical_key: candidate.canonicalKey,
        so_number: candidate.soNumber,
        rep: candidate.rep,
        institution: candidate.institution,
        amount: candidate.amount,
      },
      { onConflict: 'canonical_key', ignoreDuplicates: true }
    )
    .select('canonical_key')
  if (error) throw error

  if (!inserted || inserted.length === 0) {
    return { rung: false, webhook: null }
  }

  const webhook = await sendIncentiveBellWebhook(candidate)
  await supabase
    .from('incentive_bell_log')
    .update({ webhook_sent: webhook.sent, webhook_error: webhook.error ?? null })
    .eq('canonical_key', candidate.canonicalKey)

  return { rung: true, webhook }
}
