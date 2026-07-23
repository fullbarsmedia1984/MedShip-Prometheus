import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import {
  TamContactsBrowser,
  type TamContactsPayload,
} from '@/components/tam/TamContactsBrowser'
import { Button } from '@/components/ui/button'
import { STAFF_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import { listTamContacts } from '@/lib/tam/supabase'

export const dynamic = 'force-dynamic'

export default async function TamContactsPage() {
  // Same staff-tier gate as /api/tam/contacts; request-memoized, so this is
  // free after the tam layout's requireDashboardAuth call.
  await requireDashboardAuth(STAFF_API_AUTH_OPTIONS)

  // First-paint rows for the browser's default filter state: lab_sim role +
  // email required, page 1, 25 rows. Matches what parseContactListParams
  // produces for the component's mount query (contactRole=lab_sim sets both
  // contactRoles and roles). On failure the client falls back to its
  // fetch-on-mount path.
  let initialData: TamContactsPayload | null = null
  try {
    initialData = await listTamContacts({
      contactRoles: ['lab_sim'],
      roles: ['lab_sim'],
      contactHasEmail: true,
      page: 1,
      pageSize: 25,
    })
  } catch {
    initialData = null
  }

  return (
    <div className="flex flex-col">
      <Header title="TAM Contacts" />
      <main className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-card-foreground">Contacts & Mailing</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Role-filtered contacts with mailable CSV export from nursing_tam.
            </p>
          </div>
          <Button variant="outline" render={<Link href="/dashboard/tam" />}>
            Overview
          </Button>
        </div>
        <TamContactsBrowser initialData={initialData} />
      </main>
    </div>
  )
}
