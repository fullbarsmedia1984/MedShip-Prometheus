'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Activity, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        toast.error(error.message)
        return
      }

      router.push('/dashboard')
      router.refresh()
    } catch {
      toast.error('An error occurred during login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-[#F3F0EC]">
      {/* ── Left Panel: Purple branded area ── */}
      <div className="relative hidden w-1/2 items-center justify-center overflow-hidden p-8 lg:flex">
        <div
          className="relative flex h-full w-full flex-col items-center justify-center overflow-hidden rounded-[2rem]"
          style={{
            background: 'linear-gradient(135deg, #452B90 0%, #5B3AAF 40%, #7B52D1 100%)',
          }}
        >
          {/* Subtle glass overlay shapes */}
          <div
            className="pointer-events-none absolute -left-20 -top-20 h-80 w-80 rounded-full opacity-10"
            style={{ background: 'radial-gradient(circle, white 0%, transparent 70%)' }}
          />
          <div
            className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full opacity-[0.07]"
            style={{ background: 'radial-gradient(circle, white 0%, transparent 70%)' }}
          />
          <div
            className="pointer-events-none absolute left-1/2 top-1/4 h-64 w-64 -translate-x-1/2 rounded-full opacity-[0.05]"
            style={{ background: 'radial-gradient(circle, #F8B940 0%, transparent 70%)' }}
          />

          {/* Content */}
          <div className="relative z-10 max-w-md px-8 text-center">
            <p className="mb-4 text-base font-light tracking-wide text-white/80">
              Log in to your integration dashboard
              <br />with your credentials
            </p>
            <h1 className="mb-6 text-[2.75rem] font-bold leading-tight text-white">
              The Power of
              <br />
              <span className="underline decoration-[#F8B940] decoration-[3px] underline-offset-[6px]">
                MedShip
              </span>{' '}
              Prometheus
            </h1>
            <p className="mx-auto max-w-sm text-sm leading-relaxed text-white/60">
              Seamlessly orchestrate data flow between Salesforce CRM, Fishbowl
              Inventory, and QuickBooks — all from one unified hub.
            </p>
          </div>

          {/* Bottom decorative dots */}
          <div className="absolute bottom-10 flex gap-2">
            <span className="h-2 w-2 rounded-full bg-white/40" />
            <span className="h-2 w-6 rounded-full bg-white" />
            <span className="h-2 w-2 rounded-full bg-white/40" />
          </div>
        </div>
      </div>

      {/* ── Right Panel: Login form ── */}
      <div className="flex w-full flex-col items-center justify-center px-6 py-12 lg:w-1/2 lg:px-16">
        <div className="w-full max-w-md">
          {/* Mobile logo — only visible below lg */}
          <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
            <Activity className="h-7 w-7 text-[#452B90]" />
            <span className="text-2xl font-semibold text-[#374557]">MedShip</span>
            <span className="text-2xl font-light text-[#888]">Prometheus</span>
          </div>

          {/* Welcome heading */}
          <h2 className="mb-2 text-center text-[2rem] font-bold text-[#374557]">
            Welcome Back
          </h2>
          <p className="mb-8 text-center text-sm leading-relaxed text-[#888]">
            Sign in to access your integration dashboard and monitor
            real-time sync activity.
          </p>

          {/* Divider with "Login" label */}
          <div className="mb-8 flex items-center gap-4">
            <div className="h-px flex-1 bg-[#E6E6E6]" />
            <span className="text-sm font-semibold text-[#374557]">Login</span>
            <div className="h-px flex-1 bg-[#E6E6E6]" />
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-sm font-medium text-[#374557]"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@medshipllc.com"
                required
                className="h-12 w-full rounded-[0.625rem] border border-[#E6E6E6] bg-white px-4 text-sm text-[#374557] outline-none transition-all placeholder:text-[#bbb] focus:border-[#452B90] focus:ring-2 focus:ring-[#452B90]/20"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="mb-1.5 block text-sm font-medium text-[#374557]"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="h-12 w-full rounded-[0.625rem] border border-[#E6E6E6] bg-white px-4 pr-12 text-sm text-[#374557] outline-none transition-all placeholder:text-[#bbb] focus:border-[#452B90] focus:ring-2 focus:ring-[#452B90]/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#888] hover:text-[#374557]"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4.5 w-4.5" />
                  ) : (
                    <Eye className="h-4.5 w-4.5" />
                  )}
                </button>
              </div>
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-2">
              <input
                id="remember"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-[#E6E6E6] text-[#452B90] accent-[#452B90]"
              />
              <label htmlFor="remember" className="text-sm text-[#888]">
                Remember my preference
              </label>
            </div>

            {/* Submit button */}
            <button
              type="submit"
              disabled={loading}
              className={cn(
                'flex h-12 w-full items-center justify-center rounded-[0.625rem] text-sm font-semibold text-white transition-all',
                loading
                  ? 'cursor-not-allowed bg-[#452B90]/70'
                  : 'bg-[#452B90] shadow-[0_4px_20px_rgba(69,43,144,0.35)] hover:bg-[#3a2479] hover:shadow-[0_6px_25px_rgba(69,43,144,0.45)] active:scale-[0.98]'
              )}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign Me In'
              )}
            </button>
          </form>

          {/* Footer text */}
          <p className="mt-8 text-center text-sm text-[#888]">
            Integration Hub &mdash; SF + Fishbowl + QB
          </p>
        </div>
      </div>
    </div>
  )
}
