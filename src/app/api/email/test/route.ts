import { NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getEmailConfiguration, sendEmailTest } from '@/lib/email'

export async function POST() {
  const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
  if (!auth.authorized) return auth.response

  const email = auth.user?.email
  if (!email) {
    return NextResponse.json(
      { error: 'Your account does not have an email address.' },
      { status: 400 }
    )
  }

  const config = getEmailConfiguration()
  if (!config.ready || !config.appUrl) {
    return NextResponse.json(
      { error: config.issues.join(' ') || 'Email is not ready.' },
      { status: 503 }
    )
  }

  const result = await sendEmailTest({ to: email, appUrl: config.appUrl })
  if (!result.sent) {
    return NextResponse.json(
      { error: result.error ?? 'The provider rejected the test email.' },
      { status: 502 }
    )
  }

  return NextResponse.json({ sent: true, provider: result.provider, id: result.id ?? null })
}
