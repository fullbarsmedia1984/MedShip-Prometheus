'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const inputClass =
  'h-12 w-full rounded-[0.625rem] border border-[#D6DEE3] bg-white px-4 text-sm text-[#1C3C6E] outline-none transition-all placeholder:text-[#bbb] focus:border-[#1E98D5] focus:ring-2 focus:ring-[#1E98D5]/20'

// Most-used passwords that clear the length rule; length is the primary
// defense (NIST 800-63B), so composition below is encouraged, not required.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyuiop', 'iloveyou', 'sunshine', 'princess', 'football',
  'baseball', 'superman', 'trustno1', 'welcome1', 'admin123', 'letmein1',
  'medical1', 'medship1', 'prometheus',
])

type PasswordRule = {
  label: string
  passed: boolean
  required: boolean
}

function evaluatePassword(password: string): { rules: PasswordRule[]; valid: boolean; strength: number } {
  const rules: PasswordRule[] = [
    { label: 'At least 8 characters', passed: password.length >= 8, required: true },
    {
      label: 'Not a commonly used password',
      passed: password.length > 0 && !COMMON_PASSWORDS.has(password.toLowerCase()),
      required: true,
    },
    { label: '12 or more characters', passed: password.length >= 12, required: false },
    { label: 'Upper and lower case letters', passed: /[a-z]/.test(password) && /[A-Z]/.test(password), required: false },
    { label: 'At least one number', passed: /\d/.test(password), required: false },
    { label: 'At least one symbol', passed: /[^A-Za-z0-9]/.test(password), required: false },
  ]

  const valid = rules.filter((r) => r.required).every((r) => r.passed)
  const passedCount = rules.filter((r) => r.passed).length
  // 0-4 scale for the meter; required rules gate validity separately.
  const strength = valid ? Math.min(4, Math.max(1, passedCount - 2)) : password.length > 0 ? 1 : 0

  return { rules, valid, strength }
}

const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong']
const STRENGTH_COLORS = ['#D6DEE3', '#DC2626', '#F59E0B', '#1E98D5', '#0FA62C']

function submitClass(disabled: boolean) {
  return cn(
    'flex h-12 w-full items-center justify-center rounded-[0.625rem] text-sm font-semibold text-white transition-all',
    disabled
      ? 'cursor-not-allowed bg-[#1E98D5]/70'
      : 'bg-[#1E98D5] shadow-[0_4px_20px_rgba(30,152,213,0.35)] hover:bg-[#1a87bf] active:scale-[0.98]'
  )
}

export function ResetPasswordClient({ token }: { token: string | null }) {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(false)

  // Request mode (no token): ask for an email.
  const [email, setEmail] = useState('')
  const [requested, setRequested] = useState(false)

  // Reset mode (token present): choose a new password.
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  // A consumed/expired token can't be retried — flip back to request mode.
  const [tokenFailed, setTokenFailed] = useState(false)

  const requestReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setRequested(true)
    } finally {
      setLoading(false)
    }
  }

  const evaluation = evaluatePassword(password)
  const confirmMatches = confirm.length > 0 && password === confirm
  const canSubmit = evaluation.valid && confirmMatches && !loading

  const applyReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!evaluation.valid) {
      toast.error('The password does not meet the requirements yet.')
      return
    }
    if (password !== confirm) {
      toast.error('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        type: 'recovery',
        token_hash: token as string,
      })
      if (verifyError) {
        toast.error('This reset link has expired or was already used. Request a new one.')
        setTokenFailed(true)
        return
      }

      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        toast.error(updateError.message)
        return
      }

      // Sign the recovery session out so the normal login flow (including
      // 2FA, when enforced) is the only way in.
      await supabase.auth.signOut()
      toast.success('Password updated. Sign in with your new password.')
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }

  const showResetForm = token !== null && !tokenFailed

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F4F7F9] px-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2">
          <img src="/ms-icon-color.png" alt="Medical Shipment" className="h-8 w-8" />
          <span className="text-2xl font-semibold text-[#1C3C6E]">Medical Shipment</span>
          <span className="text-2xl font-light text-[#576671]">Prometheus</span>
        </div>

        <div className="rounded-[1rem] bg-white p-8 shadow-[0_4px_20px_rgba(28,60,110,0.08)]">
          {showResetForm ? (
            <>
              <h1 className="mb-2 text-center text-2xl font-bold text-[#1C3C6E]">
                Choose a new password
              </h1>
              <p className="mb-6 text-center text-sm text-[#576671]">
                Enter and confirm your new password below.
              </p>
              <form onSubmit={applyReset} className="space-y-4">
                <div>
                  <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-[#1C3C6E]">
                    New password
                  </label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="A long passphrase works best"
                    className={inputClass}
                  />
                </div>

                {/* Strength meter */}
                {password.length > 0 && (
                  <div>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((seg) => (
                        <div
                          key={seg}
                          className="h-1.5 flex-1 rounded-full transition-colors"
                          style={{
                            background:
                              seg <= evaluation.strength
                                ? STRENGTH_COLORS[evaluation.strength]
                                : '#E4EAEE',
                          }}
                        />
                      ))}
                    </div>
                    <p
                      className="mt-1 text-xs font-medium"
                      style={{ color: STRENGTH_COLORS[evaluation.strength] }}
                    >
                      {STRENGTH_LABELS[evaluation.strength]}
                    </p>
                  </div>
                )}

                {/* Live rule checklist */}
                <ul className="space-y-1">
                  {evaluation.rules.map((rule) => (
                    <li key={rule.label} className="flex items-center gap-2 text-xs">
                      {rule.passed ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-[#0FA62C]" />
                      ) : (
                        <X
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            rule.required && password.length > 0 ? 'text-[#DC2626]' : 'text-[#B5C8CD]'
                          )}
                        />
                      )}
                      <span className={rule.passed ? 'text-[#576671]' : 'text-[#8A99A5]'}>
                        {rule.label}
                        {!rule.required && (
                          <span className="text-[#B5C8CD]"> (recommended)</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                <div>
                  <label htmlFor="confirm" className="mb-1.5 block text-sm font-medium text-[#1C3C6E]">
                    Confirm password
                  </label>
                  <input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Repeat the password"
                    className={inputClass}
                  />
                  {confirm.length > 0 && (
                    <p
                      className={cn(
                        'mt-1.5 flex items-center gap-1.5 text-xs',
                        confirmMatches ? 'text-[#0FA62C]' : 'text-[#DC2626]'
                      )}
                    >
                      {confirmMatches ? (
                        <>
                          <Check className="h-3.5 w-3.5" /> Passwords match
                        </>
                      ) : (
                        <>
                          <X className="h-3.5 w-3.5" /> Passwords do not match
                        </>
                      )}
                    </p>
                  )}
                </div>

                <button type="submit" disabled={!canSubmit} className={submitClass(!canSubmit)}>
                  {loading ? 'Saving...' : 'Set new password'}
                </button>
              </form>
            </>
          ) : requested ? (
            <>
              <h1 className="mb-2 text-center text-2xl font-bold text-[#1C3C6E]">
                Check your email
              </h1>
              <p className="text-center text-sm leading-relaxed text-[#576671]">
                If <span className="font-medium text-[#1C3C6E]">{email}</span> has an
                account, a reset link is on its way. The link expires in an hour and
                works once.
              </p>
            </>
          ) : (
            <>
              <h1 className="mb-2 text-center text-2xl font-bold text-[#1C3C6E]">
                Reset your password
              </h1>
              <p className="mb-6 text-center text-sm text-[#576671]">
                {tokenFailed
                  ? 'That link has expired or was already used — request a fresh one.'
                  : 'Enter your email and we will send you a reset link.'}
              </p>
              <form onSubmit={requestReset} className="space-y-4">
                <div>
                  <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-[#1C3C6E]">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@medicalshipment.com"
                    className={inputClass}
                  />
                </div>
                <button type="submit" disabled={loading} className={submitClass(loading)}>
                  {loading ? 'Sending...' : 'Email me a reset link'}
                </button>
              </form>
            </>
          )}

          <p className="mt-6 text-center text-sm">
            <Link href="/login" className="text-[#1E98D5] hover:underline">
              Back to sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
