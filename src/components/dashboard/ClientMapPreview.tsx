'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { ClientMap } from './ClientMap'
import type { Customer, SeedRegionSummary } from '@/lib/seed-data'

interface ClientMapPreviewProps {
  customers: Customer[]
  regionSummaries: SeedRegionSummary[]
}

const regionColors: Record<string, string> = {
  Midwest: 'bg-purple-500/10 text-purple-700 border-purple-500/15',
  Northeast: 'bg-teal-500/10 text-teal-700 border-teal-500/15',
  Southeast: 'bg-amber-500/10 text-amber-700 border-amber-500/15',
  West: 'bg-sky-500/10 text-sky-700 border-sky-500/15',
  Southwest: 'bg-orange-500/10 text-orange-700 border-orange-500/15',
}

export function ClientMapPreview({ customers, regionSummaries }: ClientMapPreviewProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle>Client Locations</CardTitle>
        <Link
          href="/dashboard/territory"
          className="flex items-center gap-1 text-sm text-medship-primary hover:underline"
        >
          View Territory Details
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <ClientMap
          customers={customers}
          height="350px"
          colorBy="status"
          interactive={true}
          showClusters={true}
          fitBounds={true}
        />

        {/* Region Summary Bar */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {regionSummaries.map((r) => (
            <div
              key={r.region}
              className={`rounded-lg border px-3 py-2 ${regionColors[r.region] || 'bg-muted/50 text-card-foreground border-border'}`}
            >
              <p className="text-[0.7rem] font-semibold uppercase tracking-wide">{r.region}</p>
              <p className="mt-0.5 text-[0.8rem] font-bold tabular-nums">
                {r.activeCustomers} clients &middot; ${Math.round(r.totalRevenue / 1000)}k
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
