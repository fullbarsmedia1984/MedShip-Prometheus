import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import {
  TamInstitutionBrowser,
  type TamInstitutionsPayload,
} from '@/components/tam/TamInstitutionBrowser'
import { Button } from '@/components/ui/button'
import { STAFF_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import { listTamInstitutions } from '@/lib/tam/supabase'

export const dynamic = 'force-dynamic'

export default async function TamBrowserPage() {
  // Same staff-tier gate as /api/tam/institutions; request-memoized, so this
  // is free after the tam layout's requireDashboardAuth call.
  await requireDashboardAuth(STAFF_API_AUTH_OPTIONS)

  // First-paint rows for the browser's default filter state (name asc,
  // page 1, 25 rows, no filters). On failure the client falls back to its
  // fetch-on-mount path.
  let initialData: TamInstitutionsPayload | null = null
  try {
    initialData = await listTamInstitutions({
      page: 1,
      pageSize: 25,
      sortBy: 'name',
      sortDirection: 'asc',
    })
  } catch {
    initialData = null
  }

  return (
    <div className="flex flex-col">
      <Header title="TAM Browser" />
      <main className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-card-foreground">Data Browser</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Server-paginated institution search with SQL-side filters and CSV export.
            </p>
          </div>
          <Button variant="outline" render={<Link href="/dashboard/tam" />}>
            Overview
          </Button>
        </div>
        <TamInstitutionBrowser initialData={initialData} />
      </main>
    </div>
  )
}
