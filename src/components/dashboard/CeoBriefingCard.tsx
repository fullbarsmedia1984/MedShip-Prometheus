'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fetchJson } from '@/lib/client-api'

type Briefing = {
  date: string
  text: string
  source: 'ai' | 'fallback'
  generatedAt: string
}

// Self-contained daily briefing card for the CEO/ops overview. Renders
// nothing until a briefing exists (the daily 7am Chicago cron writes one;
// admins can regenerate on demand).
export function CeoBriefingCard() {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const payload = await fetchJson<{ briefing: Briefing | null }>('/api/dashboard/briefing')
      setBriefing(payload.briefing)
    } catch {
      // Non-manager roles or transient errors: card simply doesn't render.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const regenerate = async () => {
    setRefreshing(true)
    try {
      const payload = await fetchJson<{ briefing: Briefing }>('/api/dashboard/briefing', { method: 'POST' })
      setBriefing(payload.briefing)
    } catch {
      // Non-admins can't regenerate; leave the current briefing in place.
    } finally {
      setRefreshing(false)
    }
  }

  if (!briefing) return null

  return (
    <Card className="border-medship-primary/30 bg-medship-primary/[0.03]">
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
            <Sparkles className="h-4 w-4 text-medship-primary" />
            Daily Briefing
            <Badge variant="outline">{briefing.date}</Badge>
            {briefing.source === 'fallback' && <Badge variant="outline">auto-generated</Badge>}
          </p>
          <Button variant="ghost" size="sm" onClick={regenerate} disabled={refreshing} title="Regenerate (admin)">
            <RefreshCw className={refreshing ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
          </Button>
        </div>
        <p className="text-sm leading-relaxed text-card-foreground">{briefing.text}</p>
      </CardContent>
    </Card>
  )
}
