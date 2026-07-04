'use client'

import { Target } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ScorecardGateCardProps {
  enrollments: number
  threshold: number
  qualifies: boolean
  recurringRate?: number
  fullRate?: number
}

function pct(rate: number): string {
  const value = rate * 100
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`
}

export function ScorecardGateCard({ enrollments, threshold, qualifies, recurringRate, fullRate }: ScorecardGateCardProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-primary/10">
            <Target className="h-4 w-4 text-medship-primary" />
          </span>
          New-Customer Enrollments (MTD)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <span className="text-4xl font-semibold leading-none">
            {enrollments}
            <span className="text-xl text-muted-foreground"> / {threshold}</span>
          </span>
          <Badge
            variant="outline"
            className={cn(
              qualifies
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-700'
            )}
          >
            {recurringRate !== undefined
              ? `Recurring at ${pct(recurringRate)}`
              : qualifies ? 'Qualifying' : 'Not yet qualifying'}
          </Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {qualifies
            ? `Quota met — your recurring business pays the full ${pct(fullRate ?? 0.04)} this month.`
            : `Enroll ${threshold}+ first-ever customers this calendar month to earn the full ${pct(fullRate ?? 0.04)} on recurring business — fewer enrollments reduce your recurring rate.`}
        </p>
      </CardContent>
    </Card>
  )
}
