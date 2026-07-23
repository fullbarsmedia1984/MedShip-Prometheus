'use client'

import dynamic from 'next/dynamic'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { TamByStateDollarsRow, TamByTierRow } from '@/lib/tam/supabase'

// recharts is ~100kb+ of client JS; defer it so the overview page's initial
// bundle stays lean. The skeleton mirrors the charts' fixed 320px height so
// nothing shifts when the real charts hydrate in.
function ChartsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>TAM by Program Tier</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] w-full animate-pulse rounded-md bg-muted" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Top States by Allocated TAM</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] w-full animate-pulse rounded-md bg-muted" />
        </CardContent>
      </Card>
    </div>
  )
}

const TamOverviewCharts = dynamic(
  () => import('./TamOverviewCharts').then((mod) => mod.TamOverviewCharts),
  { ssr: false, loading: () => <ChartsSkeleton /> }
)

export function TamOverviewChartsLazy({
  byTier,
  byStateDollars,
}: {
  byTier: TamByTierRow[]
  byStateDollars: TamByStateDollarsRow[]
}) {
  return <TamOverviewCharts byTier={byTier} byStateDollars={byStateDollars} />
}
