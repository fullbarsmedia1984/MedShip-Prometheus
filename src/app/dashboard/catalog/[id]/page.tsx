'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronDown, ChevronRight, Star } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { Badge } from '@/components/ui/badge'
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
import type { CatalogItemDetail } from '@/lib/hercules/catalog-browse'

function money(value: number | null, currency: string) {
  if (value === null) return '—'
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  })
}

function dims(uom: {
  length: number | null
  width: number | null
  height: number | null
  dimensionUnit: string | null
}) {
  if (uom.length === null && uom.width === null && uom.height === null) return '—'
  const parts = [uom.length, uom.width, uom.height].map((v) => (v === null ? '?' : v))
  return `${parts.join(' × ')}${uom.dimensionUnit ? ` ${uom.dimensionUnit}` : ''}`
}

function AttributeRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value ?? '—'}</span>
    </div>
  )
}

export default function CatalogItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [detail, setDetail] = useState<CatalogItemDetail | null>(null)
  const [canSeePrices, setCanSeePrices] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRaw, setShowRaw] = useState(false)

  const fetchDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchJson<{ detail: CatalogItemDetail; canSeePrices: boolean }>(
        `/api/hercules/catalog/${encodeURIComponent(id)}`
      )
      setDetail(data.detail)
      setCanSeePrices(data.canSeePrices)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  return (
    <div className="flex h-full flex-col">
      <Header title="Supplier Catalog" />

      <main className="flex-1 space-y-6 overflow-y-auto p-4 md:p-6">
        <Link
          href="/dashboard/catalog"
          className="inline-flex items-center gap-1.5 text-sm text-medship-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to catalog
        </Link>

        {loading ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Loading item…
            </CardContent>
          </Card>
        ) : error || !detail ? (
          <EmptyState
            title="Catalog item not available"
            description={error ?? 'This item could not be found.'}
          />
        ) : (
          <>
            <div className="flex flex-col gap-4 lg:flex-row">
              <Card className="flex-1">
                <CardHeader className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={detail.status ?? 'unknown'} />
                    {detail.category && (
                      <Badge variant="outline">{detail.category}</Badge>
                    )}
                    {detail.subcategory && (
                      <Badge variant="outline" className="text-muted-foreground">
                        {detail.subcategory}
                      </Badge>
                    )}
                  </div>
                  {/* Hercules `description` is long marketing copy; the short
                      product name arrives in `brand`. */}
                  <CardTitle className="text-xl leading-snug">
                    {detail.brand ?? detail.description ?? detail.herculesItemId}
                  </CardTitle>
                  {detail.brand && detail.description && (
                    <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                      {detail.description}
                    </p>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="grid gap-x-10 sm:grid-cols-2">
                    <div>
                      <AttributeRow
                        label="Manufacturer"
                        value={detail.manufacturerName}
                      />
                      <AttributeRow
                        label="Manufacturer Part #"
                        value={
                          detail.manufacturerPartNumber && (
                            <span className="font-mono">
                              {detail.manufacturerPartNumber}
                            </span>
                          )
                        }
                      />
                      <AttributeRow
                        label="Hercules MS ID"
                        value={detail.msId && <span className="font-mono">{detail.msId}</span>}
                      />
                      <AttributeRow
                        label="Hercules Item ID"
                        value={<span className="font-mono">{detail.herculesItemId}</span>}
                      />
                    </div>
                    <div>
                      <AttributeRow label="UNSPSC" value={detail.unspsc} />
                      <AttributeRow
                        label="Country of Origin"
                        value={detail.countryOfOrigin}
                      />
                      <AttributeRow
                        label="Last Updated (source)"
                        value={
                          detail.updatedAt &&
                          new Date(detail.updatedAt).toLocaleString('en-US')
                        }
                      />
                      <AttributeRow
                        label="Images"
                        value={
                          detail.imageUrls.length > 0 ? (
                            <span>{detail.imageUrls.length} linked</span>
                          ) : (
                            '—'
                          )
                        }
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {(detail.storedImages.length > 0 || detail.imageUrls.length > 0) && (
                <Card className="lg:w-72">
                  <CardContent className="flex items-center justify-center p-4">
                    {/* Prefer our mirrored copy (Supabase Storage);
                        hotlink the source only until P16 catches up. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={detail.storedImages[0]?.url ?? detail.imageUrls[0]}
                      alt={detail.brand ?? detail.description ?? 'Catalog item'}
                      className="max-h-56 rounded-md object-contain"
                    />
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-4">
              <h2 className="text-base font-semibold">
                Vendor Offers{' '}
                <span className="font-normal text-muted-foreground">
                  ({detail.offers.length})
                </span>
              </h2>

              {detail.offers.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    No vendor offers recorded for this item.
                  </CardContent>
                </Card>
              ) : (
                detail.offers.map((offer) => (
                  <Card key={offer.id}>
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">
                          {offer.supplierName ?? offer.vendorName}
                        </CardTitle>
                        {offer.isPrimary && (
                          <Badge className="gap-1 bg-medship-primary/10 text-medship-primary hover:bg-medship-primary/10">
                            <Star className="h-3 w-3" /> Primary
                          </Badge>
                        )}
                        {offer.supplierCode && (
                          <Badge variant="outline" className="font-mono">
                            {offer.supplierCode}
                          </Badge>
                        )}
                        {offer.minimumOrderQuantity !== null && (
                          <span className="text-xs text-muted-foreground">
                            MOQ {offer.minimumOrderQuantity}
                          </span>
                        )}
                        {offer.leadTime && (
                          <span className="text-xs text-muted-foreground">
                            Lead time {offer.leadTime}
                          </span>
                        )}
                      </div>
                      {offer.vendorProductTitle && (
                        <p className="text-sm text-muted-foreground">
                          {offer.vendorProductTitle}
                        </p>
                      )}
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Unit</TableHead>
                            <TableHead>Vendor Part #</TableHead>
                            <TableHead>Pack</TableHead>
                            {canSeePrices && (
                              <>
                                <TableHead className="text-right">Catalog Price</TableHead>
                                <TableHead className="text-right">Contract Price</TableHead>
                              </>
                            )}
                            <TableHead>GTIN</TableHead>
                            <TableHead>HCPCS</TableHead>
                            <TableHead className="text-right">Weight</TableHead>
                            <TableHead>Dimensions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {offer.uoms.map((uom) => (
                            <TableRow key={uom.id}>
                              <TableCell className="text-sm">
                                {uom.uomCode ?? '—'}
                                {uom.isDefault && (
                                  <span className="ml-1.5 text-xs text-medship-primary">
                                    default
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {uom.vendorPartNumber ?? '—'}
                              </TableCell>
                              <TableCell className="text-sm">
                                {uom.package ?? uom.perQuantity ?? '—'}
                              </TableCell>
                              {canSeePrices && (
                                <>
                                  <TableCell className="text-right text-sm tabular-nums">
                                    {money(uom.listPriceAmount, uom.currency)}
                                  </TableCell>
                                  <TableCell className="text-right text-sm tabular-nums">
                                    {uom.contractPriceAmount !== null ? (
                                      money(uom.contractPriceAmount, uom.currency)
                                    ) : (
                                      <span className="text-muted-foreground">
                                        {uom.contractPriceStatus === 'not_provided'
                                          ? '—'
                                          : uom.contractPriceStatus ?? '—'}
                                      </span>
                                    )}
                                  </TableCell>
                                </>
                              )}
                              <TableCell className="font-mono text-xs">
                                {uom.gtin ?? '—'}
                              </TableCell>
                              <TableCell className="max-w-[10rem] truncate text-xs">
                                {uom.hcpcs ?? '—'}
                              </TableCell>
                              <TableCell className="text-right text-sm tabular-nums">
                                {uom.weight !== null
                                  ? `${uom.weight}${uom.weightUnit ? ` ${uom.weightUnit}` : ''}`
                                  : '—'}
                              </TableCell>
                              <TableCell className="text-sm">{dims(uom)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>

            {canSeePrices && detail.competitorPrices && detail.competitorPrices.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-base font-semibold">
                  Competitor Prices{' '}
                  <span className="font-normal text-muted-foreground">
                    ({detail.competitorPrices.length})
                  </span>
                </h2>
                <Card>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Competitor</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead className="text-right">List Price</TableHead>
                          <TableHead>Match</TableHead>
                          <TableHead>Last Checked</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.competitorPrices.map((price) => (
                          <TableRow key={`${price.competitor}-${price.url}`}>
                            <TableCell className="text-sm capitalize">
                              {price.competitor}
                            </TableCell>
                            <TableCell className="max-w-[22rem] text-sm">
                              <a
                                href={price.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="line-clamp-2 text-medship-primary hover:underline"
                              >
                                {price.title ?? price.url}
                              </a>
                            </TableCell>
                            <TableCell className="text-right text-sm tabular-nums">
                              {price.listPriceAmount !== null ? (
                                money(price.listPriceAmount, price.currency)
                              ) : (
                                <span className="text-muted-foreground">
                                  {price.priceStatus === 'quote_only'
                                    ? 'quote only'
                                    : price.priceStatus}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {price.matchMethod.replace(/_/g, ' ')}
                              {price.matchConfidence !== null &&
                                ` · ${Math.round(price.matchConfidence * 100)}%`}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {price.lastScrapedAt
                                ? new Date(price.lastScrapedAt).toLocaleDateString('en-US')
                                : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>
            )}

            {canSeePrices && (
            <Card>
              <CardHeader className="pb-2">
                <button
                  onClick={() => setShowRaw((prev) => !prev)}
                  className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  {showRaw ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  Raw Hercules payload
                </button>
              </CardHeader>
              {showRaw && (
                <CardContent>
                  <pre className="max-h-96 overflow-auto rounded-md bg-muted p-4 text-xs">
                    {JSON.stringify(detail.rawPayload, null, 2)}
                  </pre>
                </CardContent>
              )}
            </Card>
            )}
          </>
        )}
      </main>
    </div>
  )
}
