import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { TamContactsBrowser } from '@/components/tam/TamContactsBrowser'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default function TamContactsPage() {
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
        <TamContactsBrowser />
      </main>
    </div>
  )
}
