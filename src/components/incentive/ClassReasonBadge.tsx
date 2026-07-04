'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { classReasonLabel, type BadgeTone } from '@/lib/incentive/calculator'

const TONE_STYLES: Record<BadgeTone, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-700',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  danger: 'border-red-500/30 bg-red-500/10 text-red-700',
  muted: 'border-slate-500/30 bg-slate-500/10 text-slate-700',
}

export function ClassReasonBadge({ classification, title }: { classification: string; title?: string }) {
  const { label, tone } = classReasonLabel(classification)
  return (
    <Badge variant="outline" className={cn(TONE_STYLES[tone])} title={title}>
      {label}
    </Badge>
  )
}
