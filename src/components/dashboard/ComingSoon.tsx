'use client'

import { Clock3 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface ComingSoonBadgeProps {
  className?: string
}

export function ComingSoonBadge({ className }: ComingSoonBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'border-amber-500/30 bg-amber-500/10 text-amber-700',
        className
      )}
    >
      Coming Soon
    </Badge>
  )
}

interface ComingSoonPanelProps {
  title?: string
  description?: string
  className?: string
}

export function ComingSoonPanel({
  title = 'Coming Soon',
  description = 'This module is waiting on a live Salesforce or Fishbowl data source.',
  className,
}: ComingSoonPanelProps) {
  return (
    <div
      className={cn(
        'flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-amber-500/35 bg-amber-500/5 p-8 text-center',
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-700">
        <Clock3 className="h-5 w-5" />
      </div>
      <ComingSoonBadge />
      <div>
        <h3 className="text-base font-semibold text-card-foreground">{title}</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
