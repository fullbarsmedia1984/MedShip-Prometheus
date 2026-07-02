import 'server-only'
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTwoFactorCodeEmail } from '@/lib/email'

export const TWO_FACTOR_COOKIE = 'ms_2fa'
const CODE_TTL_MINUTES = 10
const VERIFIED_TTL_MS = 12 * 60 * 60 * 1000 // re-verify twice a day
const MAX_ATTEMPTS = 5

// Enforcement is opt-in so the branch can deploy before Resend/email is fully
// configured without locking anyone out. Flip TWO_FACTOR_ENABLED=true once
// EMAIL_FROM + RESEND_API_KEY are set and templates verified.
export function isTwoFactorEnforced(): boolean {
  return process.env.TWO_FACTOR_ENABLED === 'true'
}

function secret(): string {
  const value = process.env.TWO_FACTOR_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!value) throw new Error('TWO_FACTOR_SECRET is not configured')
  return value
}

function hashCode(userId: string, code: string): string {
  return createHmac('sha256', secret()).update(`${userId}:${code}`).digest('hex')
}

/** Signed value proving this user cleared 2FA, valid until `expiry`. */
export function issueVerifiedCookie(userId: string): { value: string; maxAgeSeconds: number } {
  const expiry = Date.now() + VERIFIED_TTL_MS
  const mac = createHmac('sha256', secret()).update(`${userId}.${expiry}`).digest('hex')
  return { value: `${expiry}.${mac}`, maxAgeSeconds: Math.floor(VERIFIED_TTL_MS / 1000) }
}

export function isVerifiedCookieValid(userId: string, cookieValue: string | undefined): boolean {
  if (!cookieValue) return false
  const [expiryStr, mac] = cookieValue.split('.')
  if (!expiryStr || !mac) return false

  const expiry = Number(expiryStr)
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false

  const expected = createHmac('sha256', secret()).update(`${userId}.${expiry}`).digest('hex')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Generate a code, store its hash, and email the plaintext to the user. */
export async function issueChallenge(userId: string, email: string): Promise<void> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const supabase = createAdminClient()

  await supabase.from('auth_challenges').insert({
    user_id: userId,
    code_hash: hashCode(userId, code),
    expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
  })

  await sendTwoFactorCodeEmail({ to: email, code, minutes: CODE_TTL_MINUTES })
}

export type VerifyResult = { ok: boolean; error?: string }

/** Verify the newest unconsumed code for the user. Single-use, rate-limited. */
export async function verifyChallenge(userId: string, code: string): Promise<VerifyResult> {
  const supabase = createAdminClient()

  const { data: challenge } = await supabase
    .from('auth_challenges')
    .select('id, code_hash, expires_at, consumed_at, attempts')
    .eq('user_id', userId)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!challenge) return { ok: false, error: 'No active code. Request a new one.' }
  if (new Date(challenge.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'Code expired. Request a new one.' }
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: 'Too many attempts. Request a new code.' }
  }

  const provided = Buffer.from(hashCode(userId, code))
  const stored = Buffer.from(challenge.code_hash)
  const matches = provided.length === stored.length && timingSafeEqual(provided, stored)

  if (!matches) {
    await supabase
      .from('auth_challenges')
      .update({ attempts: challenge.attempts + 1 })
      .eq('id', challenge.id)
    return { ok: false, error: 'Incorrect code.' }
  }

  await supabase
    .from('auth_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', challenge.id)

  return { ok: true }
}
