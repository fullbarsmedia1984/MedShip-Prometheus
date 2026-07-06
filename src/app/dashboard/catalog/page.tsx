'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpen, Building2, Layers, PackageSearch } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { DataTable } from '@/components/dashboard/DataTable'
import { KpiCard } from '@/components/dashboard/KpiCard'
import { StatusBadge } from '@/components/dashboard/StatusBadge'
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
  CatalogListItem,
  CatalogListResult,
} from '@/lib/hercules/catalog-browse'

type CatalogResponse = {
  result: CatalogListResult
  facets: CatalogFacets | null
}

interface Filters {
  search: string
  manufacturer: string
  category: string
  page: number
}

const PAGE_SIZE = 25

export default function SupplierCatalogPage() {
  const [filters, setFilters] = useState<Filters>({
    search: '',
    manufacturer: 'all',
    category: 'all',
    page: 1,
  })
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [result, setResult] = useState<CatalogListResult | null>(null)
  const [facets, setFacets] = useState<CatalogFacets | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), 300)
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
      if (!facets) params.set('facets', '1')

      const data = await fetchJson<CatalogResponse>(`/api/hercules/catalog?${params}`)
      setResult(data.result)
      if (data.facets) setFacets(data.facets)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.page, filters.manufacturer, filters.category, debouncedSearch])

  useEffect(() => {
    fetchCatalog()
  }, [fetchCatalog])

  useEffect(() => {
    setFilters((prev) => ({ ...prev, page: 1 }))
  }, [filters.manufacturer, filters.category, debouncedSearch])

  const columns = [
    {
      key: 'manufacturerPartNumber',
      label: 'MPN',
      render: (value: string | null, row: CatalogListItem) => (
        <Link
          href={`/dashboard/catalog/${encodeURIComponent(row.id)}`}
          className="font-mono text-sm text-medship-primary hover:underline"
        >
          {value ?? row.herculesItemId.slice(-8)}
        </Link>
      ),
    },
    {
      key: 'description',
      label: 'Description',
      render: (value: string | null, row: CatalogListItem) => (
        <span className="line-clamp-2 max-w-[26rem] text-sm font-medium">
          {value ?? row.brand ?? '—'}
        </span>
      ),
    },
    {
      key: 'manufacturerName',
      label: 'Manufacturer',
      render: (value: string | null) => (
        <span className="text-sm text-muted-foreground">{value ?? '—'}</span>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (value: string | null, row: CatalogListItem) => (
        <span className="text-sm text-muted-foreground">
          {value ?? '—'}
          {row.subcategory ? (
            <span className="text-muted-foreground/60"> / {row.subcategory}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'vendorOfferCount',
      label: 'Vendors',
      className: 'text-right',
      render: (value: number) => (
        <span className="text-sm tabular-nums">{value > 0 ? value : '—'}</span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (value: string | null) => <StatusBadge status={value ?? 'unknown'} />,
    },
  ]

  return (
    <div className="flex h-full flex-col">
      <Header title="Supplier Catalog" />

      <main className="flex-1 space-y-6 overflow-y-auto p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            title="Catalog Items"
            value={result?.total ?? 0}
            icon={BookOpen}
          />
          <KpiCard
            title="Items with Vendor Offers"
            value={facets?.itemsWithOffers ?? 0}
            icon={PackageSearch}
            iconColor="text-medship-success"
          />
          <KpiCard
            title="Vendor Offers"
            value={facets?.vendorOffers ?? 0}
            icon={Layers}
          />
          <KpiCard
            title="Suppliers"
            value={facets?.suppliers ?? 0}
            icon={Building2}
            iconColor="text-medship-dark-blue"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            placeholder="Search description, MPN, manufacturer…"
            value={filters.search}
            onChange={(event) =>
              setFilters((prev) => ({ ...prev, search: event.target.value }))
            }
            className="sm:max-w-sm"
          />
          <Select
            value={filters.manufacturer}
            onValueChange={(value) =>
              setFilters((prev) => ({ ...prev, manufacturer: value ?? 'all' }))
            }
          >
            <SelectTrigger className="sm:w-64">
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
          <Select
            value={filters.category}
            onValueChange={(value) =>
              setFilters((prev) => ({ ...prev, category: value ?? 'all' }))
            }
          >
            <SelectTrigger className="sm:w-64">
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
        </div>

        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <DataTable
            columns={columns}
            data={result?.data ?? []}
            totalItems={result?.total ?? 0}
            page={filters.page}
            pageSize={PAGE_SIZE}
            onPageChange={(page) => setFilters((prev) => ({ ...prev, page }))}
            emptyMessage={
              loading ? 'Loading catalog…' : 'No catalog items match these filters'
            }
          />
        </div>
      </main>
    </div>
  )
}
