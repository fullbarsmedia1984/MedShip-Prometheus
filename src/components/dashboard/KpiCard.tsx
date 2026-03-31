'use client'

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

  // Derive the bg color from iconColor
  const bgMap: Record<string, string> = {
    'text-medship-primary': 'bg-medship-primary/10',
    'text-medship-success': 'bg-medship-success/10',
    'text-medship-info': 'bg-medship-info/10',
    'text-medship-warning': 'bg-medship-warning/10',
    'text-medship-danger': 'bg-medship-danger/10',
    'text-medship-secondary': 'bg-medship-secondary/10',
  }
  const iconBg = bgMap[iconColor] || 'bg-medship-primary/10'

  return (
    <div className="overflow-hidden rounded-[0.625rem] border border-[#E6E6E6] bg-card shadow-[0_0_2.5rem_0_rgba(82,63,105,0.1)] dark:border-[rgba(255,255,255,0.1)] dark:shadow-none">
      <div className="flex items-center gap-4 px-5 py-5">
        {/* Icon — YashAdmin's widget-stat media: 5.3125rem round container */}
        <div
          className={cn(
            'flex h-[3.75rem] w-[3.75rem] shrink-0 items-center justify-center rounded-full',
            iconBg,
            iconColor
          )}
        >
          <Icon className="h-6 w-6" />
        </div>

        {/* Content */}
        <div className="flex flex-col">
          <span className="text-[2rem] font-semibold leading-tight text-card-foreground">
            {formatValue(value)}
          </span>
          <span className="mt-0.5 text-[0.875rem] font-medium uppercase text-muted-foreground">
            {title}
          </span>
        </div>

        {/* Trend */}
        {hasChange && (
          <div className="ml-auto">
            <span
              className={cn(
                'inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-xs font-medium',
                isGood
                  ? 'bg-medship-success/10 text-medship-success'
                  : 'bg-medship-danger/10 text-medship-danger'
              )}
            >
              {isPositiveChange ? (
                <ArrowUpRight className="h-3.5 w-3.5" />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5" />
              )}
              {Math.abs(change!).toFixed(1)}%
            </span>
            {changeLabel && (
              <p className="mt-0.5 text-right text-[0.625rem] text-muted-foreground">
                {changeLabel}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
