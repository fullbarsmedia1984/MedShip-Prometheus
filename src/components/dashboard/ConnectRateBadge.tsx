'use client'

import { cn } from '@/lib/utils'

interface ConnectRateBadgeProps {
  rate: number
  className?: string
}

export function ConnectRateBadge({ rate, className }: ConnectRateBadgeProps) {
  const color =
    rate >= 75
      ? 'bg-emerald-500/15 text-emerald-600'
      : rate >= 50
        ? 'bg-amber-500/15 text-amber-600'
        : 'bg-red-500/15 text-red-500'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-[0.7rem] font-semibold tabular-nums tracking-wide whitespace-nowrap',
        color,
        className
      )}
    >
      {rate.toFixed(0)}%
    </span>
  )
}
