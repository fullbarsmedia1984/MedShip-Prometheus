'use client'

import { cn } from '@/lib/utils'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { CheckCircle, Send, PlusCircle, XCircle } from 'lucide-react'
import type { SeedSalesActivity, SeedSalesRep } from '@/lib/seed-data'

interface SalesActivityFeedProps {
  activities: SeedSalesActivity[]
  reps: SeedSalesRep[]
}

function relativeTime(timestamp: string): string {
  const now = new Date('2026-03-31T12:00:00Z')
  const then = new Date(timestamp)
  const diffMs = now.getTime() - then.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay === 1) return 'yesterday'
  return `${diffDay}d ago`
}

const typeConfig = {
  deal_closed: {
    icon: CheckCircle,
    iconColor: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    label: 'Closed',
  },
  quote_sent: {
    icon: Send,
    iconColor: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    label: 'Quote Sent',
  },
  opportunity_created: {
    icon: PlusCircle,
    iconColor: 'text-medship-primary',
    bgColor: 'bg-medship-primary/10',
    label: 'New Opp',
  },
  deal_lost: {
    icon: XCircle,
    iconColor: 'text-red-400',
    bgColor: 'bg-red-400/10',
    label: 'Lost',
  },
}

export function SalesActivityFeed({ activities, reps }: SalesActivityFeedProps) {
  const repColorMap = new Map(reps.map(r => [r.id, r.color]))

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Recent Sales Activity</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        <div className="h-[420px] space-y-1 overflow-y-auto pr-1">
          {activities.map((activity, idx) => {
            const config = typeConfig[activity.type]
            const Icon = config.icon
            const repColor = repColorMap.get(activity.repId) || '#888'

            return (
              <div
                key={activity.id}
                className={cn(
                  'group relative flex gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted/50',
                  idx !== activities.length - 1 && 'border-b border-border/30'
                )}
              >
                {/* Rep avatar */}
                <div className="relative shrink-0">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full text-[0.65rem] font-bold text-white"
                    style={{ backgroundColor: repColor }}
                  >
                    {activity.repName.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className={cn('absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full', config.bgColor)}>
                    <Icon className={cn('h-2.5 w-2.5', config.iconColor)} />
                  </div>
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <p className="text-[0.8rem] leading-snug text-card-foreground">
                    <span className="font-semibold">{activity.repName}</span>
                    {activity.type === 'deal_closed' && <> closed deal with <span className="font-medium">{activity.customerName}</span></>}
                    {activity.type === 'quote_sent' && <> sent quote to <span className="font-medium">{activity.customerName}</span></>}
                    {activity.type === 'opportunity_created' && <> created new opportunity with <span className="font-medium">{activity.customerName}</span></>}
                    {activity.type === 'deal_lost' && <> lost deal with <span className="font-medium">{activity.customerName}</span></>}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.65rem] font-semibold',
                      config.bgColor, config.iconColor
                    )}>
                      ${activity.amount.toLocaleString()}
                    </span>
                    <span className="text-[0.65rem] text-muted-foreground">
                      {relativeTime(activity.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
