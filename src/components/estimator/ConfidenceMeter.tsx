import { cn } from '@/lib/utils'
import { confidenceTone, formatPct } from './estimator-types'

const SEGMENTS = 10

export function ConfidenceMeter({
  confidence,
  threshold,
  compact = false,
}: {
  confidence: number
  threshold: number
  compact?: boolean
}) {
  const tone = confidenceTone(confidence, threshold)
  const filled = Math.round(confidence * SEGMENTS)
  const fillClass =
    tone === 'high'
      ? 'bg-medship-success'
      : tone === 'medium'
        ? 'bg-medship-warning'
        : 'bg-medship-accent'
  const textClass =
    tone === 'high'
      ? 'text-medship-success'
      : tone === 'medium'
        ? 'text-medship-warning'
        : 'text-medship-accent'

  return (
    <div className={cn('flex items-center gap-2', compact ? '' : 'gap-3')}>
      <div className="flex gap-[3px]" aria-hidden>
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={cn(
              'rounded-sm transition-colors',
              compact ? 'h-2.5 w-1' : 'h-3.5 w-1.5',
              i < filled ? fillClass : 'bg-medship-border dark:bg-white/10'
            )}
          />
        ))}
      </div>
      <span className={cn('font-semibold tabular-nums', compact ? 'text-xs' : 'text-sm', textClass)}>
        {formatPct(confidence)} verified
      </span>
    </div>
  )
}
