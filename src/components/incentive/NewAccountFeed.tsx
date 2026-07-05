'use client'

import { Bell } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatUsd } from '@/lib/incentive/calculator'
import type { BellLogRow } from '@/lib/incentive/types'

function relativeTime(value: string): string {
  const then = new Date(value).getTime()
  if (!Number.isFinite(then)) return ''
  const minutes = Math.round((Date.now() - then) / 60_000)
  if (minutes < 60) return `${Math.max(minutes, 0)}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function NewAccountFeed({ feed }: { feed: BellLogRow[] }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-medship-success/10">
            <Bell className="h-4 w-4 text-medship-success" />
          </span>
          New-Account Bell
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Rings once per canonical customer on their first completed order.
        </p>
      </CardHeader>
      <CardContent>
        {feed.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No new accounts enrolled yet this promo.</p>
        ) : (
          <ul className="space-y-3">
            {feed.map((entry) => (
              <li key={entry.canonical_key} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5">🔔</span>
                <div className="min-w-0">
                  <p className="truncate font-medium">{entry.institution ?? entry.canonical_key}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.rep ?? 'Unknown rep'} · SO {entry.so_number ?? '—'} ·{' '}
                    {entry.amount !== null ? formatUsd(Number(entry.amount)) : '—'} · {relativeTime(entry.rung_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
