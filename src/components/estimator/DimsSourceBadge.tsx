import { cn } from '@/lib/utils'
import type { DimsSource } from '@/lib/packing-engine'

const STYLES: Record<DimsSource, { label: string; className: string; dot: string }> = {
  verified: {
    label: 'Verified',
    className: 'bg-medship-success/10 text-medship-success border-medship-success/30',
    dot: 'bg-medship-success',
  },
  catalog: {
    label: 'Hercules — unverified',
    className: 'bg-medship-primary/10 text-medship-primary border-medship-primary/30',
    dot: 'bg-medship-primary',
  },
  fishbowl: {
    label: 'Fishbowl — untrusted',
    className: 'bg-medship-warning/10 text-medship-warning border-medship-warning/40',
    dot: 'bg-medship-warning',
  },
  default: {
    label: 'Missing dims',
    className: 'bg-medship-accent/10 text-medship-accent border-medship-accent/30',
    dot: 'bg-medship-accent',
  },
}

export function DimsSourceBadge({ source }: { source: DimsSource }) {
  const style = STYLES[source]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-medium whitespace-nowrap',
        style.className
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      {style.label}
    </span>
  )
}
