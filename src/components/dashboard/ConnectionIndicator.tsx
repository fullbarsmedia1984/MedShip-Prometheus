import { cn } from '@/lib/utils'

type ConnectionStatus = 'connected' | 'disconnected' | 'error' | 'not_configured'

interface ConnectionIndicatorProps {
  status: ConnectionStatus
  label?: string
  showLabel?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const statusColors: Record<ConnectionStatus, string> = {
  connected: 'bg-green-500',
  disconnected: 'bg-yellow-500',
  error: 'bg-red-500',
  not_configured: 'bg-gray-400',
}

const statusLabels: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Error',
  not_configured: 'Not Configured',
}

const sizeClasses = {
  sm: 'h-2 w-2',
  md: 'h-3 w-3',
  lg: 'h-4 w-4',
}

export function ConnectionIndicator({
  status,
  label,
  showLabel = false,
  size = 'md',
}: ConnectionIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'inline-block rounded-full',
          statusColors[status],
          sizeClasses[size],
          status === 'connected' && 'animate-pulse'
        )}
      />
      {showLabel && (
        <span className="text-sm text-gray-600">
          {label || statusLabels[status]}
        </span>
      )}
    </div>
  )
}
