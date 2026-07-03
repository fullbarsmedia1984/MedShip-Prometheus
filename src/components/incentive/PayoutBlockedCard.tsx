'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

interface PayoutBlockedCardProps {
  blockingUnmappedCount: number
  compact?: boolean
}

/**
 * Fail-loudly surface: rendered wherever a commission figure would appear
 * while unmapped salesperson strings exist in the promo period. Payout
 * numbers are intentionally impossible to show in this state.
 */
export function PayoutBlockedCard({ blockingUnmappedCount, compact = false }: PayoutBlockedCardProps) {
  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700">
        <AlertTriangle className="h-3 w-3" /> blocked
      </span>
    )
  }

  return (
    <Card className="border-red-500/40 bg-red-500/5">
      <CardContent className="flex items-start gap-3 py-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
        <div className="text-sm">
          <p className="font-semibold text-red-700">Payout figures unavailable</p>
          <p className="mt-1 text-muted-foreground">
            {blockingUnmappedCount} unmapped salesperson {blockingUnmappedCount === 1 ? 'string' : 'strings'} have
            orders in the promo period. Commission numbers cannot be trusted until every order is attributable to a
            rep.
          </p>
          <Link
            href="/dashboard/incentives/admin#aliases"
            className="mt-2 inline-block font-medium text-red-700 underline underline-offset-2"
          >
            Resolve rep mappings →
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
