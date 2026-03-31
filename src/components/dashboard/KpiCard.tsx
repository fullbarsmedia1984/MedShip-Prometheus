'use client'

import { Card, CardContent } from '@/components/ui/card'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface KpiCardProps {
  title: string
  value: string | number
  change?: number
  changeLabel?: string
  icon: React.ElementType
  invertChange?: boolean
  iconColor?: string
}

function formatValue(value: string | number): string {
  if (typeof value === 'number') {
    return value.toLocaleString('en-US')
  }
  // If string starts with $, format the numeric portion with commas
  if (value.startsWith('$')) {
    const num = parseFloat(value.replace(/[$,]/g, ''))
    if (!isNaN(num)) {
      return '$' + num.toLocaleString('en-US', {
        minimumFractionDigits: num % 1 !== 0 ? 2 : 0,
        maximumFractionDigits: 2,
      })
    }
  }
  return value
}

export function KpiCard({
  title,
  value,
  change,
  changeLabel,
  icon: Icon,
  invertChange = false,
  iconColor = 'text-medship-primary',
}: KpiCardProps) {
  const isPositiveChange = change !== undefined && change > 0
  const isGood = invertChange ? !isPositiveChange : isPositiveChange
  const hasChange = change !== undefined && change !== 0

  return (
    <Card className="shadow-sm">
      <CardContent className="pt-1">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-muted-foreground">
              {title}
            </span>
            <span className="text-2xl font-bold tracking-tight text-medship-heading">
              {formatValue(value)}
            </span>
            {hasChange && (
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium',
                    isGood
                      ? 'bg-medship-success/10 text-medship-success'
                      : 'bg-medship-danger/10 text-medship-danger'
                  )}
                >
                  {isPositiveChange ? (
                    <ArrowUpRight className="h-3 w-3" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" />
                  )}
                  {Math.abs(change).toFixed(1)}%
                </span>
                {changeLabel && (
                  <span className="text-xs text-muted-foreground">
                    {changeLabel}
                  </span>
                )}
              </div>
            )}
          </div>
          <div
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
              iconColor.replace('text-', 'bg-') + '/10',
              iconColor
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
