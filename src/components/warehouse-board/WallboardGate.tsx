'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function WallboardGate() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(false)
    const res = await fetch('/api/warehouse-board/gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      router.refresh()
    } else {
      setError(true)
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0F1A2E] p-8">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#162035] p-8 shadow-2xl"
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#1E98D5]">
          Medical Shipment · Warehouse
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">
          Shipping Wallboard
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Enter the display password to start the board.
        </p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Display password"
          autoFocus
          className={`mt-5 w-full rounded-lg border bg-[#0F1A2E] px-4 py-3 text-white outline-none transition-colors placeholder:text-slate-500 ${
            error ? 'border-[#D93025]' : 'border-white/10 focus:border-[#1E98D5]'
          }`}
          data-testid="gate-password"
        />
        {error && (
          <p className="mt-2 text-sm text-[#FF6B5E]">Wrong password — try again.</p>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 w-full rounded-lg bg-[#1E98D5] px-4 py-3 font-semibold text-white transition-colors hover:bg-[#3AACE3] disabled:opacity-50"
          data-testid="gate-submit"
        >
          {busy ? 'Checking…' : 'Start board'}
        </button>
      </form>
    </div>
  )
}
