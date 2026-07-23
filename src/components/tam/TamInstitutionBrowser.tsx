'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { Download, Search } from 'lucide-react'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { fetchJson } from '@/lib/client-api'
import type {
  TamContactRow,
  TamInstitutionListRow,
  TamInstitutionSortKey,
  TamProgramRow,
  TamSortDirection,
} from '@/lib/tam/supabase'

export type TamInstitutionsPayload = {
  data: TamInstitutionListRow[]
  totalItems: number
  page: number
  pageSize: number
}

type InstitutionDetail = Omit<TamInstitutionListRow, 'programs' | 'contacts'> & {
  street: string | null
  zip: string | null
  phone: string | null
  website: string | null
  mail_street: string | null
  mail_suite: string | null
  mail_zip: string | null
  programs: TamProgramRow[]
  contacts: TamContactRow[]
}

type DetailPayload = {
  institution: InstitutionDetail
}

const TIERS = ['cna', 'lpn', 'adn', 'diploma', 'bsn', 'graduate']
const CONTACT_ROLES = ['dean', 'lab_sim', 'program_director', 'other']
const SORT_KEYS: Array<{ value: TamInstitutionSortKey; label: string }> = [
  { value: 'name', label: 'Name' },
  { value: 'state', label: 'State' },
  { value: 'city', label: 'City' },
  { value: 'control', label: 'Control' },
  { value: 'unitid', label: 'Unit ID' },
]

const INSTITUTION_COLUMNS: ColumnDef<TamInstitutionListRow>[] = [
  {
    accessorKey: 'name',
    header: 'Institution',
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-card-foreground">{row.original.name}</p>
        <p className="text-xs text-muted-foreground">
          Unit ID {row.original.unitid ?? 'n/a'}
        </p>
      </div>
    ),
  },
  {
    id: 'location',
    header: 'Location',
    cell: ({ row }) =>
      [row.original.city, row.original.state].filter(Boolean).join(', '),
  },
  {
    accessorKey: 'control',
    header: 'Control',
    cell: ({ row }) => (
      <span className="capitalize">{row.original.control.replaceAll('_', ' ')}</span>
    ),
  },
  {
    id: 'programs',
    header: 'Programs',
    cell: ({ row }) =>
      row.original.programs.map((program) => program.tier.toUpperCase()).join(', ') || '-',
  },
  {
    id: 'contacts',
    header: 'Contacts',
    cell: ({ row }) =>
      row.original.contacts.length > 0
        ? row.original.contacts.map((contact) => label(contact.role_category)).join(', ')
        : '-',
  },
  {
    id: 'enrollment',
    header: () => <span className="block text-right">Enrollment</span>,
    cell: ({ row }) => (
      <span className="block text-right tabular-nums">
        {formatNumber(
          row.original.programs.reduce(
            (sum, program) => sum + (program.est_annual_enrollment ?? 0),
            0
          )
        )}
      </span>
    ),
  },
]

function formatNumber(value: number | string | null | undefined) {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0)
  return new Intl.NumberFormat('en-US').format(Number.isFinite(numeric) ? numeric : 0)
}

function label(value: string) {
  return value.replaceAll('_', ' ').toUpperCase()
}

function buildQuery(filters: {
  search: string
  state: string
  tier: string
  contactRole: string
  contactHasEmail: boolean
  sortBy: TamInstitutionSortKey
  sortDirection: TamSortDirection
  page: number
  pageSize: number
}) {
  const params = new URLSearchParams()
  if (filters.search.trim()) params.set('search', filters.search.trim())
  if (filters.state.trim()) params.set('state', filters.state.trim().toUpperCase())
  if (filters.tier) params.set('tier', filters.tier)
  if (filters.contactRole) params.set('contactRole', filters.contactRole)
  if (filters.contactHasEmail) params.set('contactHasEmail', 'true')
  params.set('sortBy', filters.sortBy)
  params.set('sortDirection', filters.sortDirection)
  params.set('page', String(filters.page))
  params.set('pageSize', String(filters.pageSize))
  return params
}

export function TamInstitutionBrowser({
  initialData = null,
}: {
  /**
   * First-paint payload the server page fetched with this component's
   * default filter state (name asc, page 1, 25 rows, no filters). When
   * provided, the mount fetch is skipped — the initial filter state below is
   * always the default (the only URL param, institutionId, deep-links the
   * detail dialog and does not affect the list query).
   */
  initialData?: TamInstitutionsPayload | null
}) {
  const searchParams = useSearchParams()
  const deepLinkedInstitutionId = searchParams.get('institutionId')
  const [search, setSearch] = useState('')
  const [state, setState] = useState('')
  const [tier, setTier] = useState('')
  const [contactRole, setContactRole] = useState('')
  const [contactHasEmail, setContactHasEmail] = useState(false)
  const [sortBy, setSortBy] = useState<TamInstitutionSortKey>('name')
  const [sortDirection, setSortDirection] = useState<TamSortDirection>('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [payload, setPayload] = useState<TamInstitutionsPayload | null>(initialData)
  const [loading, setLoading] = useState(!initialData)
  const [error, setError] = useState<string | null>(null)
  const skipInitialFetchRef = useRef(initialData !== null)
  const [detail, setDetail] = useState<InstitutionDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [openedDeepLinkId, setOpenedDeepLinkId] = useState<string | null>(null)

  const query = useMemo(
    () =>
      buildQuery({
        search,
        state,
        tier,
        contactRole,
        contactHasEmail,
        sortBy,
        sortDirection,
        page,
        pageSize,
      }),
    [
      contactHasEmail,
      contactRole,
      page,
      pageSize,
      search,
      sortBy,
      sortDirection,
      state,
      tier,
    ]
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPayload(await fetchJson<TamInstitutionsPayload>(`/api/tam/institutions?${query}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load institutions')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    // Server-rendered first paint: the default-state rows arrived as a prop,
    // so skip the very first fetch. Any filter/sort/page change reruns this
    // effect (new loadData identity) and fetches normally.
    if (skipInitialFetchRef.current) {
      skipInitialFetchRef.current = false
      return
    }
    loadData()
  }, [loadData])

  const totalPages = Math.max(1, Math.ceil((payload?.totalItems ?? 0) / pageSize))
  const exportHref = `/api/tam/institutions/export?${query}`
  const table = useReactTable({
    data: payload?.data ?? [],
    columns: INSTITUTION_COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  })

  const openDetail = useCallback(async (institutionId: string) => {
    setDetailOpen(true)
    setDetail(null)
    try {
      const data = await fetchJson<DetailPayload>(`/api/tam/institution/${institutionId}`)
      setDetail(data.institution)
    } catch (err) {
      setDetailOpen(false)
      setError(err instanceof Error ? err.message : 'Unable to load institution detail')
    }
  }, [])

  useEffect(() => {
    if (!deepLinkedInstitutionId || deepLinkedInstitutionId === openedDeepLinkId) return
    setOpenedDeepLinkId(deepLinkedInstitutionId)
    void openDetail(deepLinkedInstitutionId)
  }, [deepLinkedInstitutionId, openDetail, openedDeepLinkId])

  function applyFilters() {
    setPage(1)
    loadData()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Institution Browser</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <div className="xl:col-span-2">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search institutions"
              />
            </div>
            <Input
              value={state}
              onChange={(event) => setState(event.target.value)}
              placeholder="State"
              maxLength={2}
            />
            <select
              value={tier}
              onChange={(event) => setTier(event.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">All tiers</option>
              {TIERS.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
            <select
              value={contactRole}
              onChange={(event) => setContactRole(event.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
            >
              <option value="">All contacts</option>
              {CONTACT_ROLES.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
            <Button onClick={applyFilters}>
              <Search className="h-4 w-4" />
              Apply
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={contactHasEmail}
                onChange={(event) => {
                  setContactHasEmail(event.target.checked)
                  setPage(1)
                }}
                className="h-4 w-4 accent-medship-primary"
              />
              Contact email required
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as TamInstitutionSortKey)}
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              >
                {SORT_KEYS.map((item) => (
                  <option key={item.value} value={item.value}>
                    Sort: {item.label}
                  </option>
                ))}
              </select>
              <select
                value={sortDirection}
                onChange={(event) => setSortDirection(event.target.value as TamSortDirection)}
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                }}
                className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              >
                {[10, 25, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size} rows
                  </option>
                ))}
              </select>
              <Button variant="outline" render={<a href={exportHref} />}>
                <Download className="h-4 w-4" />
                CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="p-6 text-sm text-medship-danger">{error}</div>
          ) : loading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading institutions...</div>
          ) : !payload || payload.data.length === 0 ? (
            <EmptyState title="No institutions match these filters" />
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => openDetail(row.original.id)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
        <p className="text-sm text-muted-foreground">
          {payload
            ? `Showing page ${page} of ${totalPages} (${formatNumber(payload.totalItems)} institutions)`
            : 'No rows loaded'}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{detail?.name ?? 'Loading institution'}</DialogTitle>
            <DialogDescription>
              {[detail?.city, detail?.state, detail?.zip].filter(Boolean).join(', ')}
            </DialogDescription>
          </DialogHeader>
          {!detail ? (
            <div className="py-6 text-sm text-muted-foreground">Loading detail...</div>
          ) : (
            <div className="space-y-5">
              <section>
                <h3 className="mb-2 text-sm font-semibold text-card-foreground">Programs</h3>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tier</TableHead>
                        <TableHead>Award</TableHead>
                        <TableHead className="text-right">Completions</TableHead>
                        <TableHead className="text-right">Enrollment</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.programs.map((program) => (
                        <TableRow key={program.id}>
                          <TableCell className="font-medium uppercase">{program.tier}</TableCell>
                          <TableCell>{program.award_level ?? '-'}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(program.annual_completions)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(program.est_annual_enrollment)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold text-card-foreground">Contacts</h3>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.contacts.map((contact) => (
                        <TableRow key={contact.id}>
                          <TableCell>
                            <p className="font-medium">{contact.name}</p>
                            <p className="text-xs text-muted-foreground">{contact.title ?? '-'}</p>
                          </TableCell>
                          <TableCell>{label(contact.role_category)}</TableCell>
                          <TableCell>{contact.email ?? '-'}</TableCell>
                          <TableCell>{contact.phone ?? '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
