'use client'

import { cn } from '@/lib/utils'

interface QuoteStatusBadgeProps {
  status: 'sent' | 'viewed' | 'accepted' | 'expired' | 'rejected'
}

const statusStyles: Record<string, string> = {
  sent: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  viewed: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  accepted: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  expired: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  rejected: 'bg-red-500/10 text-red-500 border-red-500/20',
}

const statusLabels: Record<string, string> = {
  sent: 'Sent',
  viewed: 'Viewed',
  accepted: 'Accepted',
  expired: 'Expired',
  rejected: 'Rejected',
}

export function QuoteStatusBadge({ status }: QuoteStatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold capitalize',
        statusStyles[status]
      )}
    >
      {statusLabels[status]}
    </span>
  )
}
