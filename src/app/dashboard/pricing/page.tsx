'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  Clock3,
  Database,
  DollarSign,
  FileText,
  Link as LinkIcon,
  Package,
  RefreshCw,
  ShieldAlert,
  Upload,
  XCircle,
} from 'lucide-react'
import { ComingSoonBadge, ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { Header } from '@/components/layout/Header'
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
import { fetchJson } from '@/lib/client-api'
import { cn } from '@/lib/utils'

type ReadinessStatus = 'ready' | 'warning' | 'failed' | 'missing' | 'unknown'

type ReadinessMetric = {
  key: string
  label: string
  value: number | string | null
  total?: number | null
  coveragePct?: number | null
  thresholdPct?: number | null
  status: ReadinessStatus
  owner?: string | null
  description?: string | null
}

type PricingModule = {
  title: string
  description: string
  icon: React.ElementType
  status: ReadinessStatus | 'coming-soon'
}

type PricingReadinessPayload = {
  generatedAt?: string
  overallStatus?: unknown
  checks?: unknown
  metrics?: unknown
  readinessMetrics?: unknown
  gates?: unknown
  qualityGates?: unknown
  missingData?: unknown
  gaps?: unknown
  summary?: unknown
  report?: unknown
}

const FALLBACK_METRICS: ReadinessMetric[] = [
  {
    key: 'product-crosswalk',
    label: 'Product Crosswalk Coverage',
    value: null,
    status: 'missing',
    description: 'Waiting for the readiness endpoint to report Salesforce and Fishbowl product matching.',
  },
  {
    key: 'contract-pricing',
    label: 'Contract Price Coverage',
    value: null,
    status: 'missing',
    description: 'No live contract price source has been exposed to this UI yet.',
  },
  {
    key: 'cogs',
    label: 'COGS Coverage',
    value: null,
    status: 'missing',
    description: 'No current cost basis coverage is available yet.',
  },
  {
    key: 'quote-lines',
    label: 'Quote Line Coverage',
    value: null,
    status: 'missing',
    description: 'Waiting for line item readiness data before margin or guardrail enforcement.',
  },
]

const MODULES: PricingModule[] = [
  {
    title: 'Product Matching Review',
    description: 'Review Salesforce and Fishbowl identity coverage once crosswalk diagnostics are available.',
    icon: LinkIcon,
    status: 'missing',
  },
  {
    title: 'Contract Price Manager',
    description: 'Read contract coverage now; import and edit workflows stay disabled until role-backed APIs exist.',
    icon: FileText,
    status: 'coming-soon',
  },
  {
    title: 'Contract Import Review',
    description: 'Upload, preview, validation, and commit steps are planned for a later milestone.',
    icon: Upload,
    status: 'coming-soon',
  },
  {
    title: 'Margin Calculator',
    description: 'Pricing math will appear here after contract price and COGS coverage are trustworthy.',
    icon: Calculator,
    status: 'coming-soon',
  },
  {
    title: 'Quote Guardrail Review',
    description: 'Below-floor exceptions remain read-only until Salesforce fields and approvals are configured.',
    icon: ShieldAlert,
    status: 'coming-soon',
  },
  {
    title: 'Missing Data Drilldowns',
    description: 'Coverage gaps from the readiness report will become drilldowns for pricing operators.',
    icon: Database,
    status: 'missing',
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toLabel(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function normalizeStatus(value: unknown): ReadinessStatus {
  if (typeof value === 'boolean') return value ? 'ready' : 'failed'
  if (typeof value !== 'string') return 'unknown'

  const normalized = value.toLowerCase()
  if (['ready', 'pass', 'passed', 'healthy', 'ok', 'complete'].includes(normalized)) return 'ready'
  if (['warn', 'warning', 'needs_review', 'review'].includes(normalized)) return 'warning'
  if (['fail', 'failed', 'error', 'blocked', 'blocker', 'critical'].includes(normalized)) return 'failed'
  if (['missing', 'unavailable', 'not_available', 'coming_soon', 'coming-soon', 'unknown'].includes(normalized)) return 'missing'
  return 'unknown'
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = toNumber(record[key])
    if (value !== null) return value
  }
  return null
}

function normalizeMetric(key: string, value: unknown): ReadinessMetric {
  if (!isRecord(value)) {
    return {
      key,
      label: toLabel(key),
      value: toNumber(value) ?? (typeof value === 'string' ? value : null),
      status: 'unknown',
    }
  }

  const covered = firstNumber(value, ['covered', 'matched', 'withProductCode', 'resolved', 'count', 'value'])
  const total = firstNumber(value, ['total', 'denominator', 'rows', 'eligible'])
  const rawCoverage = firstNumber(value, ['coveragePct', 'coveragePercent', 'percent', 'pct', 'coverage'])
  const coveragePct =
    rawCoverage !== null
      ? rawCoverage > 1 ? rawCoverage : rawCoverage * 100
      : covered !== null && total !== null && total > 0
        ? (covered / total) * 100
        : null
  const thresholdPct = firstNumber(value, ['thresholdPct', 'thresholdPercent', 'targetPct', 'target'])
  const status = normalizeStatus(value.status ?? value.result ?? value.ready ?? value.passed)

  return {
    key,
    label: typeof value.label === 'string' ? value.label : toLabel(key),
    value: covered ?? firstNumber(value, ['count', 'rows', 'value']),
    total,
    coveragePct,
    thresholdPct: thresholdPct !== null && thresholdPct <= 1 ? thresholdPct * 100 : thresholdPct,
    status,
    owner: typeof value.owner === 'string' ? value.owner : null,
    description: typeof value.description === 'string' ? value.description : null,
  }
}

function normalizeMetricList(value: unknown): ReadinessMetric[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (!isRecord(item)) return normalizeMetric(`metric-${index + 1}`, item)
      const key = typeof item.key === 'string' ? item.key : typeof item.id === 'string' ? item.id : `metric-${index + 1}`
      return normalizeMetric(key, item)
    })
  }

  if (isRecord(value)) {
    return Object.entries(value).map(([key, metric]) => normalizeMetric(key, metric))
  }

  return []
}

function normalizeCheckList(value: unknown): ReadinessMetric[] {
  if (!Array.isArray(value)) return []

  return value.map((item, index) => {
    if (!isRecord(item)) return normalizeMetric(`check-${index + 1}`, item)

    const key = typeof item.key === 'string' ? item.key : `check-${index + 1}`
    const nestedMetrics = normalizeMetricList(item.metrics)
    const percentMetric = nestedMetrics.find((metric) => metric.coveragePct !== null && metric.coveragePct !== undefined)
    const countMetric = nestedMetrics.find((metric) => typeof metric.value === 'number')

    return {
      key,
      label: typeof item.label === 'string' ? item.label : toLabel(key),
      value: percentMetric?.value ?? countMetric?.value ?? null,
      total: percentMetric?.total ?? countMetric?.total ?? null,
      coveragePct: percentMetric?.coveragePct ?? null,
      thresholdPct: percentMetric?.thresholdPct ?? null,
      status: normalizeStatus(item.status),
      owner: typeof item.owner === 'string' ? item.owner : null,
      description: typeof item.message === 'string'
        ? item.message
        : typeof item.description === 'string'
          ? item.description
          : typeof item.nextAction === 'string'
            ? item.nextAction
            : null,
    }
  })
}

function normalizePayload(payload: PricingReadinessPayload | null): ReadinessMetric[] {
  if (!payload) return FALLBACK_METRICS

  const report = isRecord(payload.report) ? payload.report : payload
  const metricGroups = [
    normalizeCheckList(report.checks),
    normalizeMetricList(report.metrics),
    normalizeMetricList(report.readinessMetrics),
    normalizeMetricList(report.gates),
    normalizeMetricList(report.qualityGates),
  ]
  const metrics = metricGroups.flat()

  return metrics.length > 0 ? metrics : FALLBACK_METRICS
}

function getGeneratedAt(payload: PricingReadinessPayload | null): string | undefined {
  if (!payload) return undefined
  if (typeof payload.generatedAt === 'string') return payload.generatedAt
  if (isRecord(payload.report) && typeof payload.report.generatedAt === 'string') {
    return payload.report.generatedAt
  }
  return undefined
}

function formatValue(metric: ReadinessMetric): string {
  if (metric.coveragePct !== null && metric.coveragePct !== undefined) {
    return `${Math.round(metric.coveragePct)}%`
  }
  if (typeof metric.value === 'number') return metric.value.toLocaleString('en-US')
  if (typeof metric.value === 'string') return metric.value
  return 'Missing Data'
}

function formatCount(metric: ReadinessMetric): string {
  if (typeof metric.value !== 'number') return 'Not available'
  if (typeof metric.total === 'number') {
    return `${metric.value.toLocaleString('en-US')} / ${metric.total.toLocaleString('en-US')}`
  }
  return metric.value.toLocaleString('en-US')
}

function formatDateTime(value?: string): string {
  if (!value) return 'Not available'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function getStatusBadge(status: ReadinessStatus | 'coming-soon') {
  if (status === 'coming-soon') return <ComingSoonBadge />

  const config: Record<ReadinessStatus, { label: string; className: string }> = {
    ready: {
      label: 'Ready',
      className: 'border-medship-success/30 bg-medship-success/10 text-medship-success',
    },
    warning: {
      label: 'Needs Review',
      className: 'border-medship-warning/30 bg-medship-warning/10 text-medship-warning',
    },
    failed: {
      label: 'Blocked',
      className: 'border-medship-danger/30 bg-medship-danger/10 text-medship-danger',
    },
    missing: {
      label: 'Missing Data',
      className: 'border-medship-warning/30 bg-medship-warning/10 text-medship-warning',
    },
    unknown: {
      label: 'Unknown',
      className: 'border-border bg-muted/60 text-muted-foreground',
    },
  }

  return (
    <Badge variant="outline" className={config[status].className}>
      {config[status].label}
    </Badge>
  )
}

function getOverallStatus(metrics: ReadinessMetric[], hasLiveData: boolean): ReadinessStatus {
  if (!hasLiveData) return 'missing'
  if (metrics.some((metric) => metric.status === 'failed')) return 'failed'
  if (metrics.some((metric) => ['warning', 'missing', 'unknown'].includes(metric.status))) return 'warning'
  return 'ready'
}

function getKpiIcon(index: number): React.ElementType {
  const icons = [LinkIcon, DollarSign, Package, FileText]
  return icons[index] ?? Database
}

export default function PricingPage() {
  const [payload, setPayload] = useState<PricingReadinessPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadReadiness = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const data = await fetchJson<PricingReadinessPayload>('/api/pricing/readiness')
      setPayload(data)
    } catch (err) {
      setPayload(null)
      setError(err instanceof Error ? err.message : 'Pricing readiness data is unavailable')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadReadiness()
  }, [loadReadiness])

  const metrics = useMemo(() => normalizePayload(payload), [payload])
  const hasLiveData = Boolean(payload && !error)
  const overallStatus = getOverallStatus(metrics, hasLiveData)
  const blockedCount = metrics.filter((metric) => ['failed', 'missing'].includes(metric.status)).length

  return (
    <>
      <Header title="Pricing" />
      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        <Card className="shadow-sm">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold text-card-foreground">Zeus Pricing Intelligence</h1>
                  {getStatusBadge(overallStatus)}
                </div>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Read-only pricing readiness, coverage gaps, and rollout status for product identity, contract pricing, COGS, and guardrails.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="text-xs text-muted-foreground">
                  Last checked: {formatDateTime(getGeneratedAt(payload))}
                </div>
                <Button variant="outline" size="sm" onClick={loadReadiness} disabled={loading}>
                  <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                  Refresh
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.slice(0, 4).map((metric, index) => (
            <KpiCard
              key={metric.key}
              title={metric.label}
              value={formatValue(metric)}
              icon={getKpiIcon(index)}
              iconColor={
                metric.status === 'ready'
                  ? 'text-medship-success'
                  : metric.status === 'failed'
                    ? 'text-medship-danger'
                    : 'text-medship-warning'
              }
            />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <Card className="shadow-sm xl:col-span-8">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-medship-warning" />
                Readiness Gates
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-medship-primary border-t-transparent" />
                  <span className="ml-2 text-sm text-muted-foreground">Loading pricing readiness...</span>
                </div>
              ) : !hasLiveData ? (
                <EmptyState
                  icon={Database}
                  title="Pricing readiness data is missing"
                  description="The dashboard will use /api/pricing/readiness when it is available. Until then, pricing enforcement remains disabled."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Gate</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Coverage</TableHead>
                        <TableHead className="text-right">Threshold</TableHead>
                        <TableHead>Owner</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {metrics.map((metric) => (
                        <TableRow key={metric.key}>
                          <TableCell>
                            <div className="max-w-[360px]">
                              <p className="font-medium text-card-foreground">{metric.label}</p>
                              {metric.description && (
                                <p className="mt-0.5 text-xs text-muted-foreground">{metric.description}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{getStatusBadge(metric.status)}</TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {metric.coveragePct !== null && metric.coveragePct !== undefined
                              ? `${metric.coveragePct.toFixed(1)}%`
                              : formatCount(metric)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">
                            {typeof metric.thresholdPct === 'number' ? `${metric.thresholdPct.toFixed(0)}%` : 'Not set'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {metric.owner ?? 'Unassigned'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm xl:col-span-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {overallStatus === 'ready' ? (
                  <CheckCircle2 className="h-4 w-4 text-medship-success" />
                ) : overallStatus === 'failed' ? (
                  <XCircle className="h-4 w-4 text-medship-danger" />
                ) : (
                  <Clock3 className="h-4 w-4 text-medship-warning" />
                )}
                Rollout Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-medship-warning/25 bg-medship-warning/5 p-4">
                <p className="text-sm font-medium text-card-foreground">Hard enforcement disabled</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Product crosswalk, contract price, COGS, and line item coverage must pass before Salesforce or Fishbowl guardrails block quoting.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <p className="text-2xl font-semibold tabular-nums text-card-foreground">{metrics.length}</p>
                  <p className="text-xs uppercase text-muted-foreground">Tracked Gates</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-2xl font-semibold tabular-nums text-card-foreground">{blockedCount}</p>
                  <p className="text-xs uppercase text-muted-foreground">Blocked/Missing</p>
                </div>
              </div>
              {error && (
                <p className="rounded-lg border border-medship-warning/25 bg-medship-warning/5 p-3 text-xs text-muted-foreground">
                  {error}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {MODULES.map((module) => (
            <Card key={module.title} className="shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.625rem] bg-medship-primary/10 text-medship-primary">
                    <module.icon className="h-5 w-5" />
                  </div>
                  {getStatusBadge(module.status)}
                </div>
                <h2 className="mt-4 text-base font-semibold text-card-foreground">{module.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{module.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {!hasLiveData && (
          <ComingSoonPanel
            title="Pricing data foundation"
            description="This workspace is ready for the readiness API. Missing modules will fill in as pricing schema, product crosswalks, contract prices, and COGS coverage come online."
          />
        )}
      </main>
    </>
  )
}
