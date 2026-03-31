'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import { AUTOMATION_INFO } from '@/types'
import type { Automation } from '@/types'

interface FailedSyncRowProps {
  id: string
  automation: Automation
  sourceRecordId?: string
  errorMessage?: string
  retryCount: number
  maxRetries: number
  createdAt: string
  onRetry: (id: string) => void
  isRetrying?: boolean
}

export function FailedSyncRow({
  id,
  automation,
  sourceRecordId,
  errorMessage,
  retryCount,
  maxRetries,
  createdAt,
  onRetry,
  isRetrying,
}: FailedSyncRowProps) {
  const info = AUTOMATION_INFO[automation]
  const canRetry = retryCount < maxRetries

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return date.toLocaleString()
  }

  return (
    <div className="flex items-start justify-between border-b py-4 last:border-0">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-1 h-5 w-5 text-red-500" />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{info?.name || automation}</span>
            <Badge variant="outline" className="text-xs">
              Retry {retryCount}/{maxRetries}
            </Badge>
          </div>
          {sourceRecordId && (
            <p className="mt-1 font-mono text-xs text-gray-500">
              Source: {sourceRecordId}
            </p>
          )}
          {errorMessage && (
            <p className="mt-1 text-sm text-red-600">
              {errorMessage.length > 100
                ? errorMessage.substring(0, 100) + '...'
                : errorMessage}
            </p>
          )}
          <p className="mt-1 text-xs text-gray-400">{formatTime(createdAt)}</p>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onRetry(id)}
        disabled={!canRetry || isRetrying}
      >
        <RefreshCw className={`mr-2 h-4 w-4 ${isRetrying ? 'animate-spin' : ''}`} />
        {isRetrying ? 'Retrying...' : 'Retry'}
      </Button>
    </div>
  )
}
