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

// Self-contained daily briefing card for the CEO/ops overview. Always
// visible to manager+ roles: shows the latest briefing (daily 7am Chicago
// cron), or a Generate button when none exists yet. Hidden only when the
// viewer's role can't read the endpoint.
export function CeoBriefingCard() {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [visible, setVisible] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const payload = await fetchJson<{ briefing: Briefing | null }>('/api/dashboard/briefing')
      setBriefing(payload.briefing)
      setVisible(true)
    } catch {
      // Role can't read the endpoint (or transient error) — stay hidden.
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const regenerate = async () => {
    setRefreshing(true)
    setActionError(null)
    try {
      const payload = await fetchJson<{ briefing: Briefing }>('/api/dashboard/briefing', { method: 'POST' })
      setBriefing(payload.briefing)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Generation failed (admin role required)')
    } finally {
      setRefreshing(false)
    }
  }

  if (!visible) return null

  return (
    <Card className="border-medship-primary/30 bg-medship-primary/[0.03]">
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
            <Sparkles className="h-4 w-4 text-medship-primary" />
            Daily Briefing
            {briefing && <Badge variant="outline">{briefing.date}</Badge>}
            {briefing?.source === 'fallback' && <Badge variant="outline">auto-generated</Badge>}
          </p>
          <Button variant="outline" size="sm" onClick={regenerate} disabled={refreshing} title="Regenerate now (admin)">
            <RefreshCw className={refreshing ? 'mr-1.5 h-3.5 w-3.5 animate-spin' : 'mr-1.5 h-3.5 w-3.5'} />
            {refreshing ? 'Generating…' : briefing ? 'Regenerate' : 'Generate briefing'}
          </Button>
        </div>
        {briefing ? (
          <p className="text-sm leading-relaxed text-card-foreground">{briefing.text}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            No briefing yet today — it generates automatically at 7:00 AM Chicago, or click Generate.
          </p>
        )}
        {actionError && <p className="text-xs font-medium text-medship-danger">{actionError}</p>}
      </CardContent>
    </Card>
  )
}
