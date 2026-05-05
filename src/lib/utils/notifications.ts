const DEFAULT_ALERT_RECIPIENTS = [
  'dan@medicalshipment.com',
  'steven@fullbarsmedia.com',
]

type AlertPayload = {
  subject: string
  text: string
  html?: string
  recipients?: string[]
}

function getAlertRecipients() {
  const configured = process.env.ALERT_EMAIL_RECIPIENTS
    ?.split(',')
    .map((email) => email.trim())
    .filter(Boolean)

  return configured?.length ? configured : DEFAULT_ALERT_RECIPIENTS
}

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

  const resendApiKey = process.env.RESEND_API_KEY
  const from = process.env.ALERT_EMAIL_FROM
  if (resendApiKey && from) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: recipients,
          subject,
          text,
          html,
        }),
      })

      if (!response.ok) {
        return {
          sent: false,
          provider: 'resend',
          error: `Resend returned HTTP ${response.status}: ${await response.text()}`,
        }
      }

      return { sent: true, provider: 'resend' }
    } catch (error) {
      return {
        sent: false,
        provider: 'resend',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  return {
    sent: false,
    provider: 'none',
    error: 'Set ALERT_WEBHOOK_URL or RESEND_API_KEY + ALERT_EMAIL_FROM to enable email delivery.',
  }
}
