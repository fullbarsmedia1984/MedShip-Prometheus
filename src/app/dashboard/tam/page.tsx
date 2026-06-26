import type React from 'react'
import Link from 'next/link'
import { DollarSign, GraduationCap, MapPinned, Users } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { TamOverviewCharts } from '@/components/tam/TamOverviewCharts'
import { TamScenarioTabs } from '@/components/tam/TamScenarioTabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  getTamOverview,
  type TamByStateDollarsRow,
  type TamScenario,
} from '@/lib/tam/supabase'

export const dynamic = 'force-dynamic'

type PageProps = {
  searchParams?: Promise<{ scenario?: string }>
}

function parseScenario(value: string | undefined): TamScenario {
  if (value === 'low' || value === 'high' || value === 'base') return value
  return 'base'
}

function toNumber(value: string | number | null | undefined) {
  if (typeof value === 'number') return value
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCurrency(value: string | number | null | undefined) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(toNumber(value))
}

function formatNumber(value: string | number | null | undefined) {
  return new Intl.NumberFormat('en-US').format(toNumber(value))
}

function stateRows(rows: TamByStateDollarsRow[]) {
  return [...rows]
    .sort((a, b) => toNumber(b.total_tam) - toNumber(a.total_tam))
    .slice(0, 15)
}

function OverviewMetricCard({
  title,
  value,
  icon,
}: {
  title: string
  value: string | number
  icon: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-[3.75rem] w-[3.75rem] shrink-0 items-center justify-center rounded-full bg-medship-primary/10 text-medship-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-semibold leading-tight text-card-foreground">
            {value}
          </p>
          <p className="mt-0.5 text-sm font-medium uppercase text-muted-foreground">
            {title}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

export default async function TamDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams
  const scenario = parseScenario(params?.scenario)
  const overview = await getTamOverview(scenario)
  const selectedSummary = overview.selectedSummary
  const totalStates = overview.byStateDollars.length
  const effectiveStudents = overview.byStateDollars.reduce(
    (sum, row) => sum + toNumber(row.effective_students),
    0
  )

  return (
    <div className="flex flex-col">
      <Header title="TAM" />

      <main className="space-y-6 p-4 md:p-6">
        <Card>
          <CardContent className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-semibold text-card-foreground">
                  TAM
                </h1>
                <Badge variant="outline" className="capitalize">
                  {scenario} scenario
                </Badge>
                <Badge variant="outline">Read-only</Badge>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Live analytics over the isolated nursing_tam schema, queried server-side through direct Postgres.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:items-end">
              <TamScenarioTabs scenario={scenario} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" render={<Link href="/dashboard/tam/browser" />}>
                  Browser
                </Button>
                <Button size="sm" variant="outline" render={<Link href="/dashboard/tam/map" />}>
                  Map
                </Button>
                <Button size="sm" variant="outline" render={<Link href="/dashboard/tam/contacts" />}>
                  Contacts
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
          <OverviewMetricCard
            title="Allocated TAM"
            value={formatCurrency(selectedSummary?.total_tam)}
            icon={<DollarSign className="h-6 w-6" />}
          />
          <OverviewMetricCard
            title="Nursing Programs"
            value={formatNumber(selectedSummary?.n_programs)}
            icon={<GraduationCap className="h-6 w-6" />}
          />
          <OverviewMetricCard
            title="Effective Students"
            value={formatNumber(effectiveStudents)}
            icon={<Users className="h-6 w-6" />}
          />
          <OverviewMetricCard
            title="Mapped States"
            value={totalStates}
            icon={<MapPinned className="h-6 w-6" />}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>TAM Mix</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">Consumables</p>
                <p className="text-2xl font-semibold text-card-foreground">
                  {formatCurrency(selectedSummary?.consumable_tam)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Equipment</p>
                <p className="text-2xl font-semibold text-card-foreground">
                  {formatCurrency(selectedSummary?.equipment_tam)}
                </p>
              </div>
              <div className="rounded-md border border-medship-primary/20 bg-medship-primary/5 p-3 text-sm text-muted-foreground">
                Scenario assumptions are read from nursing_tam views; no TAM data is stored in the app.
              </div>
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Program Tier Detail</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Programs</TableHead>
                    <TableHead className="text-right">Effective Students</TableHead>
                    <TableHead className="text-right">Total TAM</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.byTier.map((row) => (
                    <TableRow key={row.tier}>
                      <TableCell className="font-medium uppercase">{row.tier}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(row.n_programs)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(row.effective_students)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatCurrency(row.total_tam)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <TamOverviewCharts
          byTier={overview.byTier}
          byStateDollars={overview.byStateDollars}
        />

        <Card>
          <CardHeader>
            <CardTitle>Top States by Allocated TAM</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Programs</TableHead>
                  <TableHead className="text-right">Effective Students</TableHead>
                  <TableHead className="text-right">Allocated TAM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stateRows(overview.byStateDollars).map((row) => (
                  <TableRow key={row.state}>
                    <TableCell className="font-medium">{row.state}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(row.n_programs)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(row.effective_students)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatCurrency(row.total_tam)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
