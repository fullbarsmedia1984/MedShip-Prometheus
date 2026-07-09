import 'server-only'
import { Resend } from 'resend'

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
 * Sends from EMAIL_FROM (Steven's Resend-verified domain — never a
 * medicalshipment.com address, which is managed elsewhere). Returns a result
 * object rather than throwing so callers can decide whether a failed email is
 * fatal (2FA) or best-effort (notifications).
 */
export async function sendEmail(input: SendEmailInput): Promise<EmailResult> {
  const resend = getResendClient()
  const from = process.env.EMAIL_FROM

  if (!resend || !from) {
    return {
      sent: false,
      provider: 'none',
      error: 'Email is not configured. Set RESEND_API_KEY and EMAIL_FROM.',
    }
  }

  // Catch a malformed sender before the API call so the error names the env
  // var instead of surfacing as an opaque Resend 422.
  if (!/^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$|^.+ ?<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/.test(from)) {
    return {
      sent: false,
      provider: 'none',
      error: `EMAIL_FROM ("${from}") is invalid. Use email@example.com or Name <email@example.com>.`,
    }
  }

  try {
    const { data, error } = await resend.emails.send({
      from,
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
