import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { TamMapClient } from '@/components/tam/TamMapClient'
import { Button } from '@/components/ui/button'

export const dynamic = 'force-dynamic'

export default function TamMapPage() {
  return (
    <div className="flex flex-col">
      <Header title="Nursing TAM Map" />
      <main className="space-y-6 p-4 md:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-card-foreground">Map Visualizations</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Kepler.gl visualization over geocoded nursing institutions and allocated state TAM.
            </p>
          </div>
          <Button variant="outline" render={<Link href="/dashboard/tam" />}>
            Overview
          </Button>
        </div>
        <TamMapClient />
      </main>
    </div>
  )
}
