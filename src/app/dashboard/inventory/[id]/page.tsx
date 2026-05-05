import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ElementType, ReactNode } from 'react'
import {
  ArrowLeft,
  Boxes,
  CalendarClock,
  ClipboardList,
  DatabaseZap,
  MapPin,
  Package,
  ShieldCheck,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { ComingSoonPanel } from '@/components/dashboard/ComingSoon'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getInventoryDetail, getStockStatus, toNumber } from './data'

type InventoryDetailPageProps = {
  params: Promise<{ id: string }>
}

type MetricCardProps = {
  icon: ElementType
  label: string
  value: string
  detail?: string
}

const toneClasses = {
  success: 'border-medship-success/30 bg-medship-success/10 text-medship-success',
  warning: 'border-medship-warning/30 bg-medship-warning/10 text-medship-warning',
  danger: 'border-medship-danger/30 bg-medship-danger/10 text-medship-danger',
}

function formatNumber(value: number | string | null | undefined): string {
  return toNumber(value).toLocaleString('en-US')
}

function formatDate(value: string | null | undefined): string {
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

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className={cn('mt-1 truncate text-sm text-foreground', mono && 'font-mono')}>
        {value}
      </dd>
    </div>
  )
}

function MetricCard({ icon: Icon, label, value, detail }: MetricCardProps) {
  return (
    <Card className="shadow-sm">
      <CardContent className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-[0.625rem] bg-medship-primary/10 text-medship-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-lg font-semibold text-foreground">{value}</p>
          {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
        </div>
      </CardContent>
    </Card>
  )
}

export default async function InventoryDetailPage({ params }: InventoryDetailPageProps) {
  const { id } = await params
  const detail = await getInventoryDetail(id)

  if (!detail) notFound()

  const { snapshot, reorderRule, sfProduct, syncSchedule, latestSyncEvent, itemSyncEvent } = detail
  const reorderPoint = reorderRule ? toNumber(reorderRule.reorder_point) : 0
  const qtyAvailable = toNumber(snapshot.qty_available)
  const stock = getStockStatus(qtyAvailable, reorderPoint)

  return (
    <>
      <Header title="Inventory Item Details" />
      <main className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mb-4">
          <Link
            href="/dashboard/inventory"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            <ArrowLeft className="h-4 w-4" />
            Inventory
          </Link>
        </div>

        <div className="space-y-6">
          <section className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={toneClasses[stock.tone]}>
                  {stock.label}
                </Badge>
                {sfProduct?.is_active === false ? (
                  <StatusBadge status="Inactive" />
                ) : (
                  <StatusBadge status="Connected" variant="dot" />
                )}
              </div>
              <h2 className="truncate text-2xl font-semibold text-foreground">
                {snapshot.part_description ?? snapshot.part_number}
              </h2>
              <p className="mt-1 font-mono text-sm text-muted-foreground">{snapshot.part_number}</p>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={Package} label="Available" value={formatNumber(snapshot.qty_available)} />
            <MetricCard icon={Boxes} label="On Hand" value={formatNumber(snapshot.qty_on_hand)} />
            <MetricCard icon={ClipboardList} label="Allocated" value={formatNumber(snapshot.qty_allocated)} />
            <MetricCard
              icon={ShieldCheck}
              label="Reorder Point"
              value={formatNumber(reorderPoint)}
              detail={reorderRule?.is_active === false ? 'Rule inactive' : undefined}
            />
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Item Identity</CardTitle>
                <CardDescription>Live Fishbowl inventory cache fields for this SKU.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <DetailField label="SKU" value={snapshot.part_number} mono />
                  <DetailField label="Inventory Row ID" value={snapshot.id} mono />
                  <DetailField label="Fishbowl Part ID" value={snapshot.fishbowl_part_id ?? 'Not available'} mono />
                  <DetailField label="UOM" value={snapshot.uom ?? 'Not available'} />
                  <DetailField label="Location" value={snapshot.location ?? 'Not available'} />
                  <DetailField label="Last Fishbowl Sync" value={formatDate(snapshot.last_synced_at)} />
                </dl>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Salesforce Product</CardTitle>
                <CardDescription>Live Product2 linkage when available.</CardDescription>
              </CardHeader>
              <CardContent>
                {sfProduct ? (
                  <dl className="space-y-4">
                    <DetailField label="Product Name" value={sfProduct.name} />
                    <DetailField label="Product Code" value={sfProduct.product_code ?? 'Not available'} mono />
                    <DetailField label="Salesforce ID" value={sfProduct.sf_id} mono />
                    <DetailField label="Family" value={sfProduct.family ?? 'Uncategorized'} />
                    <DetailField label="Last SF Inventory Sync" value={formatDate(sfProduct.last_inventory_sync ?? sfProduct.last_synced_at)} />
                  </dl>
                ) : (
                  <ComingSoonPanel
                    title="Salesforce product link coming soon"
                    description="This inventory item is live in Fishbowl cache, but no matching Salesforce Product2 row is connected yet."
                    className="min-h-56"
                  />
                )}
              </CardContent>
            </Card>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="shadow-sm xl:col-span-2">
              <CardHeader>
                <CardTitle>Reorder Rule</CardTitle>
                <CardDescription>Replenishment fields currently available in the live database.</CardDescription>
              </CardHeader>
              <CardContent>
                {reorderRule ? (
                  <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <DetailField label="Rule Status" value={reorderRule.is_active === false ? 'Inactive' : 'Active'} />
                    <DetailField label="Reorder Point" value={formatNumber(reorderRule.reorder_point)} />
                    <DetailField label="Reorder Quantity" value={formatNumber(reorderRule.reorder_quantity)} />
                    <DetailField label="Preferred Supplier" value={reorderRule.preferred_supplier ?? 'Not available'} />
                    <DetailField label="Last Triggered" value={formatDate(reorderRule.last_triggered_at)} />
                    <DetailField label="Rule Created" value={formatDate(reorderRule.created_at)} />
                  </dl>
                ) : (
                  <ComingSoonPanel
                    title="Reorder rule coming soon"
                    description="No live reorder rule is configured for this SKU yet."
                    className="min-h-56"
                  />
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Sync Health</CardTitle>
                <CardDescription>P2 inventory sync context for this item.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <DetailField
                    label="Schedule"
                    value={syncSchedule?.is_active === false ? 'Paused' : syncSchedule?.cron_expression ?? 'Not configured'}
                  />
                  <DetailField label="Next Run" value={formatDate(syncSchedule?.next_run_at)} />
                  <DetailField label="Last Schedule Run" value={formatDate(syncSchedule?.last_run_at)} />
                  <DetailField label="Last Schedule Status" value={syncSchedule?.last_run_status ?? 'Not available'} />
                  <DetailField label="Latest P2 Event" value={latestSyncEvent ? formatDate(latestSyncEvent.created_at) : 'Not available'} />
                  <DetailField label="Latest Item Event" value={itemSyncEvent ? formatDate(itemSyncEvent.created_at) : 'Not available'} />
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <MetricCard
              icon={DatabaseZap}
              label="P2 Status"
              value={itemSyncEvent?.status ?? latestSyncEvent?.status ?? 'Not available'}
            />
            <MetricCard
              icon={CalendarClock}
              label="Records Processed"
              value={formatNumber(syncSchedule?.records_processed)}
            />
            <MetricCard
              icon={MapPin}
              label="Location"
              value={snapshot.location ?? 'Not available'}
              detail={snapshot.uom ? `UOM ${snapshot.uom}` : undefined}
            />
          </section>

          <ComingSoonPanel
            title="Inventory movement history coming soon"
            description="Receipts, issues, transfers, vendor lead times, and demand forecasts need additional live Fishbowl tables before they can be shown accurately."
          />
        </div>
      </main>
    </>
  )
}
