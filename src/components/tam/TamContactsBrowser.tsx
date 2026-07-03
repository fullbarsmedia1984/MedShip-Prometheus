'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Mail, Search } from 'lucide-react'
import { EmptyState } from '@/components/dashboard/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import type { TamMailingContactRow } from '@/lib/tam/supabase'

type ContactsPayload = {
  data: TamMailingContactRow[]
  totalItems: number
  page: number
  pageSize: number
}

const TIERS = ['cna', 'lpn', 'adn', 'diploma', 'bsn', 'graduate']
const CONTACT_ROLES = ['dean', 'lab_sim', 'program_director', 'other']

function label(value: string) {
  return value.replaceAll('_', ' ').toUpperCase()
}

function formatNumber(value: number | string | null | undefined) {
  const numeric = typeof value === 'number' ? value : Number(value ?? 0)
  return new Intl.NumberFormat('en-US').format(Number.isFinite(numeric) ? numeric : 0)
}

function buildQuery(filters: {
  search: string
  state: string
  tier: string
  contactRole: string
  contactHasEmail: boolean
  page: number
  pageSize: number
}) {
  const params = new URLSearchParams()
  if (filters.search.trim()) params.set('search', filters.search.trim())
  if (filters.state.trim()) params.set('state', filters.state.trim().toUpperCase())
  if (filters.tier) params.set('tier', filters.tier)
  if (filters.contactRole) params.set('contactRole', filters.contactRole)
  if (filters.contactHasEmail) params.set('contactHasEmail', 'true')
  params.set('page', String(filters.page))
  params.set('pageSize', String(filters.pageSize))
  return params
}

export function TamContactsBrowser() {
  const [search, setSearch] = useState('')
  const [state, setState] = useState('')
  const [tier, setTier] = useState('')
  const [contactRole, setContactRole] = useState('lab_sim')
  const [contactHasEmail, setContactHasEmail] = useState(true)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [payload, setPayload] = useState<ContactsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const query = useMemo(
    () =>
      buildQuery({
        search,
        state,
        tier,
        contactRole,
        contactHasEmail,
        page,
        pageSize,
      }),
    [contactHasEmail, contactRole, page, pageSize, search, state, tier]
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPayload(await fetchJson<ContactsPayload>(`/api/tam/contacts?${query}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load contacts')
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => {
    loadData()
  }, [loadData])

  const totalPages = Math.max(1, Math.ceil((payload?.totalItems ?? 0) / pageSize))
  const exportHref = `/api/tam/contacts/export?${query}`

  function applyFilters() {
    setPage(1)
    loadData()
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Mailing Contacts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
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
              <option value="">All roles</option>
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
              Email required
            </label>
            <div className="flex flex-wrap items-center gap-2">
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
                Mail Merge CSV
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
            <div className="p-6 text-sm text-muted-foreground">Loading contacts...</div>
          ) : !payload || payload.data.length === 0 ? (
            <EmptyState title="No contacts match these filters" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Institution</TableHead>
                  <TableHead>Mailing Address</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payload.data.map((contact) => (
                  <TableRow key={contact.id}>
                    <TableCell>
                      <p className="font-medium text-card-foreground">{contact.name}</p>
                      <p className="text-xs text-muted-foreground">{contact.title ?? '-'}</p>
                    </TableCell>
                    <TableCell>{label(contact.role_category)}</TableCell>
                    <TableCell>
                      <p>{contact.institution.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {contact.institution.nursing_dept_name ?? 'Nursing department'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p>{contact.institution.mail_street ?? '-'}</p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          contact.institution.mail_city,
                          contact.institution.mail_state,
                          contact.institution.mail_zip,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </p>
                    </TableCell>
                    <TableCell>
                      {contact.email ? (
                        <a className="inline-flex items-center gap-1 text-medship-primary" href={`mailto:${contact.email}`}>
                          <Mail className="h-3.5 w-3.5" />
                          {contact.email}
                        </a>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>{contact.phone ?? '-'}</TableCell>
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
            ? `Showing page ${page} of ${totalPages} (${formatNumber(payload.totalItems)} contacts)`
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
    </div>
  )
}
