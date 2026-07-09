'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const inputClass =
  'h-12 w-full rounded-[0.625rem] border border-[#D6DEE3] bg-white px-4 text-sm text-[#1C3C6E] outline-none transition-all placeholder:text-[#bbb] focus:border-[#1E98D5] focus:ring-2 focus:ring-[#1E98D5]/20'

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

  const applyReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters.')
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
                    placeholder="At least 8 characters"
                    className={inputClass}
                  />
                </div>
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
                </div>
                <button type="submit" disabled={loading} className={submitClass(loading)}>
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
