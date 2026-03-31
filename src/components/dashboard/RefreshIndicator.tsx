'use client'

import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface RefreshIndicatorProps {
  enabled: boolean
  intervalSeconds: number
  onToggle: (enabled: boolean) => void
  lastRefreshed?: Date
}

export function RefreshIndicator({
  enabled,
  intervalSeconds,
  onToggle,
  lastRefreshed,
}: RefreshIndicatorProps) {
  const [countdown, setCountdown] = useState(intervalSeconds)

  const resetCountdown = useCallback(() => {
    setCountdown(intervalSeconds)
  }, [intervalSeconds])

  useEffect(() => {
    resetCountdown()
  }, [enabled, resetCountdown])

  useEffect(() => {
    if (!enabled) return

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) return intervalSeconds
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [enabled, intervalSeconds])

  const formatLastRefreshed = (date?: Date) => {
    if (!date) return null
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 60) return `${diffSec}s ago`
    const diffMin = Math.floor(diffSec / 60)
    return `${diffMin}m ago`
  }

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      {/* Toggle switch */}
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onToggle(!enabled)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
          enabled ? 'bg-medship-primary' : 'bg-muted-foreground/30'
        )}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
            enabled ? 'translate-x-4' : 'translate-x-0'
          )}
        />
      </button>

      <span className="text-xs font-medium">Auto-refresh</span>

      {enabled && (
        <>
          {/* Pulsing dot */}
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-medship-success opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-medship-success" />
          </span>

          <span className="text-xs tabular-nums">{countdown}s</span>
        </>
      )}

      {lastRefreshed && (
        <span className="text-xs text-muted-foreground/70">
          {formatLastRefreshed(lastRefreshed)}
        </span>
      )}
    </div>
  )
}
