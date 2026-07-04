import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import {
  TWO_FACTOR_COOKIE,
  isTwoFactorEnforced,
  issueChallenge,
  issueVerifiedCookie,
  verifyChallenge,
} from '@/lib/twofactor'

// POST /api/auth/2fa — issue and email a fresh code for the current session's
// user. Called right after a successful password login. Reports whether 2FA is
// enforced so the client knows whether to show the code step.
export async function POST() {
  if (!isTwoFactorEnforced()) {
    return NextResponse.json({ enforced: false, sent: false })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    await issueChallenge(user.id, user.email)
    return NextResponse.json({ enforced: true, sent: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send code' },
      { status: 500 }
    )
  }
}

// PUT /api/auth/2fa — verify a submitted code; on success set the signed
// verified cookie that getAuthContext requires.
export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { code } = (await request.json()) as { code?: string }
  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Enter the 6-digit code' }, { status: 400 })
  }

  const result = await verifyChallenge(user.id, code)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  const { value, maxAgeSeconds } = issueVerifiedCookie(user.id)
  const cookieStore = await cookies()
  cookieStore.set(TWO_FACTOR_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  })

  return NextResponse.json({ verified: true })
}
