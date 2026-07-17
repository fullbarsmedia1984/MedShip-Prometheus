'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowUpDown,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ImageOff,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fetchJson } from '@/lib/client-api'
import type {
  CatalogFacets,
  CatalogSearchItem,
  CatalogSearchResult,
} from '@/lib/hercules/catalog-browse'
import { cn } from '@/lib/utils'

type CatalogResponse = {
  result: CatalogSearchResult
  facets: CatalogFacets | null
  canSeePrices: boolean
}

interface Filters {
  search: string
  manufacturer: string
  category: string
  vendor: string
  sort: string
  page: number
}

const PAGE_SIZE = 25
const DEFAULT_FILTERS: Filters = {
  search: '',
  manufacturer: 'all',
  category: 'all',
  vendor: 'all',
  sort: 'relevance',
  page: 1,
}

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Best match' },
  { value: 'newest', label: 'Recently updated' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
] as const

function priceRange(item: CatalogSearchItem) {
  if (item.priceMin === null) return null
  const fmt = (v: number) =>
    v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  return item.priceMax !== null && item.priceMax !== item.priceMin
    ? `${fmt(item.priceMin)} – ${fmt(item.priceMax)}`
    : fmt(item.priceMin)
}

function Thumb({ item }: { item: CatalogSearchItem }) {
  const [broken, setBroken] = useState(false)
  return (
    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white">
      {item.imageUrl && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.imageUrl}
          alt=""
          loading="lazy"
          className="h-full w-full object-contain"
          onError={() => setBroken(true)}
        />
      ) : (
        <ImageOff className="h-5 w-5 text-muted-foreground/30" />
      )}
    </div>
  )
}

function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        })
      }}
      title={`Copy ${value}`}
      className="group/copy inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[0.7rem] text-foreground/80 transition-colors hover:bg-medship-primary/10 hover:text-medship-primary"
    >
      {label} {value}
      {copied ? (
        <Check className="h-2.5 w-2.5 text-medship-success" />
      ) : (
        <Copy className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover/copy:opacity-60" />
      )}
    </button>
  )
}

function ResultRow({
  item,
  canSeePrices,
  disambiguate,
}: {
  item: CatalogSearchItem
  canSeePrices: boolean
  disambiguate: boolean
}) {
  const price = canSeePrices ? priceRange(item) : null

  return (
    <Link
      href={`/dashboard/catalog/${encodeURIComponent(item.id)}`}
      className="group flex items-start gap-4 border-b border-border/60 px-4 py-3.5 transition-colors last:border-b-0 hover:bg-medship-primary/[0.03]"
    >
      <Thumb item={item} />

      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-sm font-medium leading-snug text-foreground group-hover:text-medship-primary">
          {item.brand ?? item.description ?? item.herculesItemId}
          {disambiguate && item.manufacturerPartNumber && (
            <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">
              · {item.manufacturerPartNumber}
            </span>
          )}
        </p>
        {item.brand && item.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
            {item.description}
          </p>
        )}
        <p className="mt-0.5 truncate text-xs text-muted-foreground/80">
          {[item.manufacturerName, item.category, item.subcategory]
            .filter(Boolean)
            .join(' · ') || '—'}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {item.manufacturerPartNumber && (
            <CopyChip label="MPN" value={item.manufacturerPartNumber} />
          )}
          {item.vendors.slice(0, 3).map((vendor) => (
            <Badge
              key={vendor}
              variant="outline"
              className="gap-1 border-medship-primary/30 px-1.5 py-0 text-[0.7rem] font-normal text-medship-dark-blue"
            >
              <Building2 className="h-2.5 w-2.5" />
              {vendor}
            </Badge>
          ))}
          {item.offerCount > item.vendors.length && (
            <span className="text-[0.7rem] text-muted-foreground">
              {item.offerCount} offers
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col items-end gap-1.5 text-right">
        {price && (
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {price}
          </span>
        )}
        <StatusBadge status={item.status ?? 'unknown'} />
      </div>
    </Link>
  )
}

function SkeletonRow() {
  return (
    <div className="flex animate-pulse items-start gap-4 border-b border-border/60 px-4 py-3.5 last:border-b-0">
      <div className="h-16 w-16 rounded-lg bg-muted" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-3.5 w-3/4 rounded bg-muted" />
        <div className="h-3 w-1/2 rounded bg-muted" />
        <div className="h-3 w-1/3 rounded bg-muted" />
      </div>
    </div>
  )
}

export default function SupplierCatalogPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [result, setResult] = useState<CatalogSearchResult | null>(null)
  const [facets, setFacets] = useState<CatalogFacets | null>(null)
  const [canSeePrices, setCanSeePrices] = useState(false)
  const [loading, setLoading] = useState(true)
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search.trim()), 300)
    return () => clearTimeout(timer)
  }, [filters.search])

  const fetchCatalog = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(filters.page),
        pageSize: String(PAGE_SIZE),
      })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (filters.manufacturer !== 'all') params.set('manufacturer', filters.manufacturer)
      if (filters.category !== 'all') params.set('category', filters.category)
      if (filters.vendor !== 'all') params.set('vendor', filters.vendor)
      if (filters.sort !== 'relevance') params.set('sort', filters.sort)
      if (!facets) params.set('facets', '1')

      const data = await fetchJson<CatalogResponse>(`/api/hercules/catalog?${params}`)
      setResult(data.result)
      setCanSeePrices(data.canSeePrices)
      if (data.facets) setFacets(data.facets)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.page, filters.manufacturer, filters.category, filters.vendor, filters.sort, debouncedSearch])

  useEffect(() => {
    fetchCatalog()
  }, [fetchCatalog])

  useEffect(() => {
    setFilters((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }))
  }, [filters.manufacturer, filters.category, filters.vendor, filters.sort, debouncedSearch])

  const hasFilters =
    debouncedSearch !== '' ||
    filters.manufacturer !== 'all' ||
    filters.category !== 'all' ||
    filters.vendor !== 'all'

  const activeChips: Array<{ label: string; clear: () => void }> = []
  if (filters.manufacturer !== 'all')
    activeChips.push({
      label: filters.manufacturer,
      clear: () => setFilters((prev) => ({ ...prev, manufacturer: 'all' })),
    })
  if (filters.category !== 'all')
    activeChips.push({
      label: filters.category,
      clear: () => setFilters((prev) => ({ ...prev, category: 'all' })),
    })
  if (filters.vendor !== 'all')
    activeChips.push({
      label: `Vendor: ${filters.vendor}`,
      clear: () => setFilters((prev) => ({ ...prev, vendor: 'all' })),
    })

  const from = (filters.page - 1) * PAGE_SIZE + 1
  const to = from + (result?.items.length ?? 0) - 1
  const summary = loading
    ? 'Searching…'
    : result && result.items.length > 0
      ? `Showing ${from.toLocaleString()}–${to.toLocaleString()}${
          !hasFilters && result.estimatedTotal
            ? ` of ~${result.estimatedTotal.toLocaleString()} items`
            : result.hasMore
              ? ' of many'
              : ` of ${to.toLocaleString()}`
        }`
      : 'No results'

  return (
    <div className="flex h-full flex-col">
      <Header title="Supplier Catalog" />

      <main className="flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        {/* Search + filter toolbar */}
        <Card className="shadow-sm">
          <CardContent className="space-y-3 p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                autoFocus
                placeholder="Search by name, description, or part number — press / to focus (e.g. ENT151623)…"
                value={filters.search}
                onChange={(event) =>
                  setFilters((prev) => ({ ...prev, search: event.target.value }))
                }
                className="h-11 pl-9 pr-9 text-[0.9rem]"
              />
              {filters.search && (
                <button
                  onClick={() => setFilters((prev) => ({ ...prev, search: '' }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
              <Select
                value={filters.vendor}
                onValueChange={(value) =>
                  setFilters((prev) => ({ ...prev, vendor: value ?? 'all' }))
                }
              >
                <SelectTrigger className="h-8 w-full text-xs sm:w-44">
                  <SelectValue placeholder="Vendor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All vendors</SelectItem>
                  {(facets?.vendors ?? []).map((entry) => (
                    <SelectItem key={entry.name} value={entry.name}>
                      {entry.name} ({entry.count.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.category}
                onValueChange={(value) =>
                  setFilters((prev) => ({ ...prev, category: value ?? 'all' }))
                }
              >
                <SelectTrigger className="h-8 w-full text-xs sm:w-52">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {(facets?.categories ?? []).map((entry) => (
                    <SelectItem key={entry.name} value={entry.name}>
                      {entry.name} ({entry.count.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={filters.manufacturer}
                onValueChange={(value) =>
                  setFilters((prev) => ({ ...prev, manufacturer: value ?? 'all' }))
                }
              >
                <SelectTrigger className="h-8 w-full text-xs sm:w-56">
                  <SelectValue placeholder="Manufacturer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All manufacturers</SelectItem>
                  {(facets?.manufacturers ?? []).map((entry) => (
                    <SelectItem key={entry.name} value={entry.name}>
                      {entry.name} ({entry.count.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex w-full items-center gap-1.5 sm:ml-auto sm:w-auto">
                <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                <Select
                  value={filters.sort}
                  onValueChange={(value) =>
                    setFilters((prev) => ({ ...prev, sort: value ?? 'relevance' }))
                  }
                >
                  <SelectTrigger className="h-8 w-full text-xs sm:w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {activeChips.map((chip) => (
                <Badge
                  key={chip.label}
                  variant="secondary"
                  className="gap-1 pr-1 text-xs font-normal"
                >
                  {chip.label}
                  <button
                    onClick={chip.clear}
                    className="rounded-full p-0.5 hover:bg-foreground/10"
                    aria-label={`Remove ${chip.label}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {(hasFilters || filters.search) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => setFilters(DEFAULT_FILTERS)}
                >
                  Reset all
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <Card className="shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-xs text-muted-foreground">{summary}</span>
            {facets && (
              <span className="hidden text-xs text-muted-foreground sm:block">
                {facets.vendorOffers.toLocaleString()} vendor offers across{' '}
                {facets.itemsWithOffers.toLocaleString()} items
              </span>
            )}
          </div>

          <div className={cn(loading && result && 'opacity-50 transition-opacity')}>
            {loading && !result ? (
              <>
                {Array.from({ length: 8 }, (_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </>
            ) : result && result.items.length > 0 ? (
              (() => {
                const titleCounts = new Map<string, number>()
                for (const item of result.items) {
                  const title = item.brand ?? item.description ?? item.herculesItemId
                  titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1)
                }
                return result.items.map((item) => {
                  const title = item.brand ?? item.description ?? item.herculesItemId
                  return (
                    <ResultRow
                      key={item.id}
                      item={item}
                      canSeePrices={canSeePrices}
                      disambiguate={(titleCounts.get(title) ?? 0) > 1}
                    />
                  )
                })
              })()
            ) : (
              <div className="px-6 py-14 text-center">
                <Search className="mx-auto h-8 w-8 text-muted-foreground/30" />
                <p className="mt-3 text-sm font-medium">No products found</p>
                <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                  Try a part number (manufacturer or vendor), fewer words, or
                  broader terms — quoted phrases and -exclusions work too
                  (e.g. <span className="font-mono">&quot;nitrile glove&quot; -sterile</span>).
                </p>
              </div>
            )}
          </div>

          {/* Pager */}
          {result && (result.hasMore || filters.page > 1) && (
            <div className="flex items-center justify-between border-t px-4 py-2.5">
              <Button
                variant="outline"
                size="sm"
                disabled={filters.page <= 1 || loading}
                onClick={() =>
                  setFilters((prev) => ({ ...prev, page: prev.page - 1 }))
                }
              >
                <ChevronLeft className="mr-1 h-4 w-4" /> Previous
              </Button>
              <span className="text-xs text-muted-foreground">
                Page {filters.page}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!result.hasMore || loading}
                onClick={() =>
                  setFilters((prev) => ({ ...prev, page: prev.page + 1 }))
                }
              >
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          )}
        </Card>
      </main>
    </div>
  )
}
