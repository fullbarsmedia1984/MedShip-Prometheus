import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPasswordResetEmail } from '@/lib/email'
import { logAudit } from '@/lib/audit'

// Supabase recovery links honor the project's OTP expiry (default 1 hour).
const LINK_TTL_MINUTES = 60
const RESEND_COOLDOWN_SECONDS = 60

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000'
}

/**
 * Public "forgot password" endpoint. Always answers { ok: true } so the
 * response never reveals whether an account exists; the email is only sent
 * when the address matches an active profile.
 */
export async function POST(request: NextRequest) {
  const ok = NextResponse.json({ ok: true })

  try {
    const body = (await request.json().catch(() => ({}))) as { email?: string }
    const email = body.email?.trim().toLowerCase()
    if (!email || !email.includes('@')) return ok

    const supabase = createAdminClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, is_active')
      .eq('email', email)
      .maybeSingle()

    if (!profile || !profile.is_active) return ok

    // Cooldown: at most one reset email per address per minute.
    const since = new Date(Date.now() - RESEND_COOLDOWN_SECONDS * 1000).toISOString()
    const { data: recent } = await supabase
      .from('audit_log')
      .select('id')
      .eq('action', 'user.password_reset_requested')
      .eq('entity_id', profile.id)
      .gte('created_at', since)
      .limit(1)
    if (recent && recent.length > 0) return ok

    const { data: link, error } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email,
    })
    if (error || !link?.properties?.hashed_token) {
      console.error('Failed to generate recovery link:', error?.message)
      return ok
    }

    // We deliver the token ourselves via Resend; the reset page redeems it
    // with verifyOtp. This avoids Supabase's default SMTP and its PKCE
    // same-browser restriction on emailed links.
    const resetUrl = `${appUrl()}/reset-password?token=${encodeURIComponent(link.properties.hashed_token)}`
    const sent = await sendPasswordResetEmail({
      to: email,
      resetUrl,
      minutes: LINK_TTL_MINUTES,
    })

    await logAudit({
      actor: { userId: null, email },
      action: 'user.password_reset_requested',
      entityType: 'profile',
      entityId: profile.id,
      summary: 'Password reset email requested',
      diff: { emailSent: sent.sent, provider: sent.provider },
    })

    return ok
  } catch (error) {
    console.error(
      'Password reset request failed:',
      error instanceof Error ? error.message : String(error)
    )
    return ok
  }
}
