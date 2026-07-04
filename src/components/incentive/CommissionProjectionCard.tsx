'use client'

import { DollarSign, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PayoutBlockedCard } from './PayoutBlockedCard'
import { formatUsd } from '@/lib/incentive/calculator'

interface CommissionProjectionCardProps {
  base: number | null
  bonus: number | null
  projected: number | null
  counterfactual: { message: string } | null
  payoutBlocked: boolean
  blockingUnmappedCount: number
}

export function CommissionProjectionCard({
  base,
  bonus,
  projected,
  counterfactual,
  payoutBlocked,
  blockingUnmappedCount,
}: CommissionProjectionCardProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-success/10">
            <DollarSign className="h-4 w-4 text-medship-success" />
          </span>
          Projected Commission (MTD)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {payoutBlocked || base === null || projected === null ? (
          <PayoutBlockedCard blockingUnmappedCount={blockingUnmappedCount} />
        ) : (
          <>
            <span className="text-4xl font-semibold leading-none">{formatUsd(projected)}</span>
            <div className="mt-3 flex gap-6 text-sm">
              <div>
                <p className="text-muted-foreground">Base</p>
                <p className="font-medium">{formatUsd(base)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">New-customer bonus</p>
                <p className="font-medium">{formatUsd(bonus ?? 0)}</p>
              </div>
            </div>
            {counterfactual && (
              <p className="mt-3 flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800">
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                {counterfactual.message}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
