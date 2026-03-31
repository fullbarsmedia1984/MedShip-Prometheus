import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  status: string
  variant?: 'default' | 'dot'
}

type ColorConfig = {
  bg: string
  text: string
  dot: string
}

function getStatusColors(status: string): ColorConfig {
  const normalized = status.toLowerCase()

  // Green statuses
  if (
    ['success', 'delivered', 'synced', 'healthy', 'connected', 'closed won'].includes(normalized)
  ) {
    return {
      bg: 'bg-medship-success/10',
      text: 'text-medship-success',
      dot: 'bg-medship-success',
    }
  }

  // Blue statuses
  if (['shipped'].includes(normalized)) {
    return {
      bg: 'bg-medship-info/10',
      text: 'text-medship-info',
      dot: 'bg-medship-info',
    }
  }

  // Purple/primary statuses
  if (['required', 'yes'].includes(normalized)) {
    return {
      bg: 'bg-medship-primary/10',
      text: 'text-medship-primary',
      dot: 'bg-medship-primary',
    }
  }

  // Orange/warning statuses
  if (['pending', 'warning', 'low stock', 'optional', 'no', 'not_configured', 'disconnected'].includes(normalized)) {
    return {
      bg: 'bg-medship-warning/10',
      text: 'text-medship-warning',
      dot: 'bg-medship-warning',
    }
  }

  // Red/danger statuses
  if (
    ['failed', 'error', 'cancelled', 'destructive', 'out of stock'].includes(normalized)
  ) {
    return {
      bg: 'bg-medship-danger/10',
      text: 'text-medship-danger',
      dot: 'bg-medship-danger',
    }
  }

  // Retrying - orange
  if (normalized === 'retrying') {
    return {
      bg: 'bg-medship-warning/10',
      text: 'text-medship-warning',
      dot: 'bg-medship-warning',
    }
  }

  // Default - gray
  return {
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    dot: 'bg-muted-foreground',
  }
}

export function StatusBadge({ status, variant = 'default' }: StatusBadgeProps) {
  const colors = getStatusColors(status)

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        colors.bg,
        colors.text
      )}
    >
      {variant === 'dot' && (
        <span className={cn('h-1.5 w-1.5 rounded-full', colors.dot)} />
      )}
      {status}
    </span>
  )
}
