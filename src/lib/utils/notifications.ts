import 'server-only'
import { sendEmail } from '@/lib/email'

type AlertPayload = {
  subject: string
  text: string
  html?: string
  recipients?: string[]
}

// Alert recipients come from config, never hardcoded (PRD §10). Set
// ALERT_EMAIL_RECIPIENTS to a comma-separated list.
function getAlertRecipients(): string[] {
  return (
    process.env.ALERT_EMAIL_RECIPIENTS
      ?.split(',')
      .map((email) => email.trim())
      .filter(Boolean) ?? []
  )
}

/**
 * Send an operational alert. Prefers ALERT_WEBHOOK_URL when set (e.g. Slack),
 * otherwise sends via the shared Resend email client. Best-effort: returns a
 * result rather than throwing so a failed alert never kills a batch.
 */
export async function sendAlertEmail({
  subject,
  text,
  html,
  recipients = getAlertRecipients(),
}: AlertPayload): Promise<{ sent: boolean; provider: string; error?: string }> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL
  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, text, html, recipients }),
      })

      if (!response.ok) {
        return {
          sent: false,
          provider: 'webhook',
          error: `Alert webhook returned HTTP ${response.status}: ${await response.text()}`,
        }
      }

      return { sent: true, provider: 'webhook' }
    } catch (error) {
      return {
        sent: false,
        provider: 'webhook',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  if (recipients.length === 0) {
    return {
      sent: false,
      provider: 'none',
      error: 'No alert recipients. Set ALERT_EMAIL_RECIPIENTS or ALERT_WEBHOOK_URL.',
    }
  }

  const result = await sendEmail({
    to: recipients,
    subject,
    text,
    html: html ?? `<p>${text}</p>`,
  })

  return { sent: result.sent, provider: result.provider, error: result.error }
}
