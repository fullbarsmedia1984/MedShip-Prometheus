import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { TamInstitutionBrowser } from '@/components/tam/TamInstitutionBrowser'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default function TamBrowserPage() {
  return (
    <div className="flex flex-col">
      <Header title="Nursing TAM Browser" />
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
        <TamInstitutionBrowser />
      </main>
    </div>
  )
}
