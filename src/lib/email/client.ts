import 'server-only'
import { Resend } from 'resend'
import { getEmailConfiguration } from './config'

export type EmailResult = {
  sent: boolean
  provider: 'resend' | 'none'
  id?: string
  error?: string
}

export type SendEmailInput = {
  to: string | string[]
  subject: string
  html: string
  text: string
}

let cachedClient: Resend | null = null

function getResendClient(): Resend | null {
  if (cachedClient) return cachedClient

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null

  cachedClient = new Resend(apiKey)
  return cachedClient
}

/**
 * Low-level send. Prefer the typed helpers in ./index.ts (sendInviteEmail,
 * sendTwoFactorCodeEmail, ...) so subjects and bodies stay consistent.
 *
 * Sends from EMAIL_FROM. Production configuration is constrained to the
 * Resend-verified medicalshipment.com domain. Returns a result object rather
 * than throwing so callers can decide whether a failed email is fatal (2FA)
 * or best-effort (notifications).
 */
export async function sendEmail(input: SendEmailInput): Promise<EmailResult> {
  const resend = getResendClient()
  const config = getEmailConfiguration()

  if (!resend || !config.ready || !config.sender) {
    return {
      sent: false,
      provider: 'none',
      error: config.issues.join(' '),
    }
  }

  try {
    const { data, error } = await resend.emails.send({
      from: config.sender,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    })

    if (error) {
      return { sent: false, provider: 'resend', error: error.message }
    }

    return { sent: true, provider: 'resend', id: data?.id }
  } catch (error) {
    return {
      sent: false,
      provider: 'resend',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
