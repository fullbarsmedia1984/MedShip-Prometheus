'use client'

import { cn } from '@/lib/utils'

const outcomeConfig: Record<string, { bg: string; text: string; label?: string }> = {
  'Interested - Next Steps': { bg: 'bg-emerald-500/15', text: 'text-emerald-600' },
  'Scheduled Demo':          { bg: 'bg-medship-primary/15', text: 'text-medship-primary' },
  'Quote Requested':         { bg: 'bg-green-500/15', text: 'text-green-600' },
  'Needs Follow-Up':         { bg: 'bg-amber-500/15', text: 'text-amber-600' },
  'Not Interested':          { bg: 'bg-red-500/15', text: 'text-red-500' },
}

interface CallOutcomeBadgeProps {
  outcome: string
  className?: string
}

export function CallOutcomeBadge({ outcome, className }: CallOutcomeBadgeProps) {
  const config = outcomeConfig[outcome] ?? { bg: 'bg-gray-500/10', text: 'text-gray-500' }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-transparent px-2.5 py-0.5 text-[0.7rem] font-semibold tracking-wide whitespace-nowrap',
        config.bg,
        config.text,
        className
      )}
    >
      {outcome}
    </span>
  )
}
