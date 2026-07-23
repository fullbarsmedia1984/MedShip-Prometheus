'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, ImageOff, Loader2, Search, Trash2 } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/lib/client-api'

type ReviewImage = {
  id: string
  itemId: string
  productName: string | null
  manufacturerName: string | null
  url: string
  source: 'hercules' | 'pocketnurse' | 'diamedical' | 'web_search'
  sourceUrl: string
  isPrimary: boolean
  createdAt: string
}

type GalleryResponse = {
  images: ReviewImage[]
  counts: Record<string, number>
  nextBefore: string | null
  canReject: boolean
}

type SourceFilter = 'web_search' | 'pocketnurse' | 'diamedical' | 'hercules' | 'all'

const SOURCE_FILTERS: Array<{ key: SourceFilter; label: string }> = [
  { key: 'web_search', label: 'Web Search' },
  { key: 'pocketnurse', label: 'Pocket Nurse' },
  { key: 'diamedical', label: 'DiaMedical' },
  { key: 'hercules', label: 'Hercules' },
  { key: 'all', label: 'All' },
]

// web_search finds are best-effort matches and the main review target,
// so they get the loud magenta accent; known-source mirrors stay calm.
const SOURCE_BADGE: Record<ReviewImage['source'], string> = {
  web_search: 'bg-[#A0007E]/10 text-[#A0007E]',
  pocketnurse: 'bg-medship-primary/10 text-medship-primary',
  diamedical: 'bg-medship-primary-dark/10 text-medship-primary-dark',
  hercules: 'bg-muted text-muted-foreground',
}

const SOURCE_LABEL: Record<ReviewImage['source'], string> = {
  web_search: 'web search',
  pocketnurse: 'pocket nurse',
  diamedical: 'diamedical',
  hercules: 'hercules',
}

function formatCount(value: number | undefined) {
  if (value === undefined) return ''
  return value >= 10_000 ? `${Math.round(value / 1000)}k` : value.toLocaleString('en-US')
}

function GalleryCard({
  image,
  index,
  canReject,
  onReject,
}: {
  image: ReviewImage
  index: number
  canReject: boolean
  onReject: (imageId: string) => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [broken, setBroken] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
  }, [])

  const handleRejectClick = async () => {
    if (!confirming) {
      setConfirming(true)
      confirmTimer.current = setTimeout(() => setConfirming(false), 3_000)
      return
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    setRejecting(true)
    try {
      await onReject(image.id)
    } finally {
      setRejecting(false)
      setConfirming(false)
    }
  }

  return (
    <Card
      className="group overflow-hidden opacity-0 transition-shadow hover:shadow-md motion-safe:animate-[gallery-in_0.35s_ease-out_forwards] motion-reduce:opacity-100"
      style={{ animationDelay: `${Math.min(index % 24, 12) * 35}ms` }}
    >
      <div className="relative flex aspect-square items-center justify-center border-b border-border/60 bg-white p-3">
        {broken ? (
          <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
            <ImageOff className="h-8 w-8" />
            <span className="text-xs">Image unavailable</span>
          </div>
        ) : (
          // Storage-hosted, size-capped mirror; plain <img> matches the
          // catalog detail page convention.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.url}
            alt={image.productName ?? 'Catalog item'}
            loading="lazy"
            onError={() => setBroken(true)}
            className="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-[1.04]"
          />
        )}
        <span
          className={cn(
            'absolute left-2 top-2 rounded-full px-2 py-0.5 text-[0.65rem] font-medium capitalize',
            SOURCE_BADGE[image.source]
          )}
        >
          {SOURCE_LABEL[image.source]}
        </span>
        {canReject && (
          <Button
            variant={confirming ? 'destructive' : 'secondary'}
            size="sm"
            disabled={rejecting}
            onClick={handleRejectClick}
            className={cn(
              'absolute right-2 top-2 h-7 gap-1 px-2 text-xs shadow-sm transition-opacity',
              confirming ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100'
            )}
          >
            {rejecting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {confirming ? 'Confirm?' : 'Reject'}
          </Button>
        )}
      </div>
      <CardContent className="space-y-1 p-3">
        <Link
          href={`/dashboard/catalog/${image.itemId}`}
          className="line-clamp-2 text-sm font-medium leading-snug hover:text-medship-primary hover:underline"
          title={image.productName ?? undefined}
        >
          {image.productName ?? 'Unnamed item'}
        </Link>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">
            {image.manufacturerName ?? '—'}
          </span>
          <a
            href={image.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open original source"
            className="shrink-0 text-muted-foreground transition-colors hover:text-medship-primary"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </CardContent>
    </Card>
  )
}

export default function EnrichmentGalleryPage() {
  const [source, setSource] = useState<SourceFilter>('web_search')
  const [images, setImages] = useState<ReviewImage[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [canReject, setCanReject] = useState(false)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPage = useCallback(
    async (activeSource: SourceFilter, before: string | null) => {
      const params = new URLSearchParams({ source: activeSource, limit: '48' })
      if (before) params.set('before', before)
      return fetchJson<GalleryResponse>(`/api/enrichment/images?${params.toString()}`)
    },
    []
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setImages([])
    fetchPage(source, null)
      .then((data) => {
        if (cancelled) return
        setImages(data.images)
        setCounts(data.counts)
        setCanReject(data.canReject)
        setNextBefore(data.nextBefore)
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : 'Unknown error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [source, fetchPage])

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await fetchPage(source, nextBefore)
      setImages((current) => [...current, ...data.images])
      setNextBefore(data.nextBefore)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unknown error')
    } finally {
      setLoadingMore(false)
    }
  }

  const rejectImage = async (imageId: string) => {
    await fetchJson('/api/enrichment/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', imageId }),
    })
    setImages((current) => current.filter((image) => image.id !== imageId))
    setCounts((current) => ({ ...current }))
  }

  const totalForFilter =
    source === 'all'
      ? Object.values(counts).reduce((sum, count) => sum + count, 0)
      : counts[source]

  return (
    <div className="flex h-full flex-col">
      <Header title="Image Review" />
      <style>{`@keyframes gallery-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }`}</style>

      <main className="flex-1 space-y-4 overflow-y-auto p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {SOURCE_FILTERS.map((filter) => {
              const isActive = source === filter.key
              const count =
                filter.key === 'all'
                  ? Object.values(counts).reduce((sum, value) => sum + value, 0)
                  : counts[filter.key]
              return (
                <button
                  key={filter.key}
                  onClick={() => setSource(filter.key)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm transition-colors',
                    isActive
                      ? 'border-medship-primary bg-medship-primary text-white'
                      : 'border-border bg-background text-muted-foreground hover:border-medship-primary/40 hover:text-foreground'
                  )}
                >
                  {filter.label}
                  {count !== undefined && (
                    <span className={cn('ml-1.5 text-xs', isActive ? 'text-white/75' : 'text-muted-foreground/70')}>
                      {formatCount(count)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          <p className="text-sm text-muted-foreground">
            Newest first · images your enrichment automations pulled into storage
            {canReject && ' · rejecting removes the image and stops automations from refilling it'}
          </p>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, index) => (
              <div key={index} className="animate-pulse overflow-hidden rounded-xl border border-border">
                <div className="aspect-square bg-muted" />
                <div className="space-y-2 p-3">
                  <div className="h-3.5 w-4/5 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <EmptyState title="Could not load images" description={error} />
        ) : images.length === 0 ? (
          <EmptyState
            title="No images yet for this source"
            description={
              source === 'web_search'
                ? 'The P18 search sweep stores its finds here as it works through the imageless backlog.'
                : 'Mirrored images will appear here as the enrichment automations run.'
            }
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {images.map((image, index) => (
                <GalleryCard
                  key={image.id}
                  image={image}
                  index={index}
                  canReject={canReject}
                  onReject={rejectImage}
                />
              ))}
            </div>

            <div className="flex items-center justify-center gap-3 pb-4 pt-2">
              {nextBefore ? (
                <Button variant="outline" onClick={loadMore} disabled={loadingMore} className="gap-2">
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Load more
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Showing all {images.length.toLocaleString('en-US')}
                  {totalForFilter !== undefined && ` of ${totalForFilter.toLocaleString('en-US')}`} loaded images
                </p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
