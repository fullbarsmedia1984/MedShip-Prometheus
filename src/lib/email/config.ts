export const PRODUCTION_EMAIL_DOMAIN = 'medicalshipment.com'

export type EmailConfiguration = {
  configured: boolean
  ready: boolean
  sender: string | null
  senderAddress: string | null
  senderDomain: string | null
  appUrl: string | null
  issues: string[]
}

const EMAIL_ADDRESS = /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/

export function senderAddress(from: string): string | null {
  const trimmed = from.trim()
  const bracketed = trimmed.match(/<([^<>]+)>$/)
  const address = (bracketed?.[1] ?? trimmed).trim().toLowerCase()
  return EMAIL_ADDRESS.test(address) ? address : null
}

/** Validate the settings that control every Zeus email. */
export function getEmailConfiguration(
  env: Record<string, string | undefined> = process.env
): EmailConfiguration {
  const apiKeyConfigured = Boolean(env.RESEND_API_KEY?.trim())
  const sender = env.EMAIL_FROM?.trim() || null
  const address = sender ? senderAddress(sender) : null
  const domain = address?.split('@')[1] ?? null
  const appUrl = env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || null
  const production = env.NODE_ENV === 'production'
  const issues: string[] = []

  if (!apiKeyConfigured) issues.push('RESEND_API_KEY is not configured.')
  if (!sender) {
    issues.push('EMAIL_FROM is not configured.')
  } else if (!address) {
    issues.push('EMAIL_FROM must be an email address or Name <email@example.com>.')
  }

  if (production && domain && domain !== PRODUCTION_EMAIL_DOMAIN) {
    issues.push(`Production EMAIL_FROM must use @${PRODUCTION_EMAIL_DOMAIN}.`)
  }

  if (!appUrl) {
    issues.push('NEXT_PUBLIC_APP_URL is not configured; invite links would be invalid.')
  } else if (production && !appUrl.startsWith('https://')) {
    issues.push('Production NEXT_PUBLIC_APP_URL must use HTTPS.')
  }

  return {
    configured: apiKeyConfigured && Boolean(sender),
    ready: issues.length === 0,
    sender,
    senderAddress: address,
    senderDomain: domain,
    appUrl,
    issues,
  }
}
