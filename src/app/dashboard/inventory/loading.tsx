import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'

/** Instant skeleton for the inventory list while the server page fetches. */
export default function InventoryLoading() {
  return (
    <>
      <Header title="Inventory" />
      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {/* Analytics band placeholder */}
        <div className="grid animate-pulse gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Card key={i} className="shadow-sm">
              <CardContent className="space-y-3 pt-4">
                <div className="h-3 w-24 rounded bg-muted" />
                <div className="h-28 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters bar placeholder */}
        <Card className="shadow-sm">
          <CardContent className="pt-4">
            <div className="flex animate-pulse flex-wrap items-center gap-3">
              <div className="h-9 w-full rounded-md bg-muted sm:w-64" />
              <div className="h-9 w-full rounded-md bg-muted sm:w-48" />
              <div className="h-9 w-full rounded-md bg-muted sm:w-44" />
              <div className="h-9 w-full rounded-md bg-muted sm:w-52" />
            </div>
          </CardContent>
        </Card>

        {/* Table placeholder */}
        <Card className="shadow-sm">
          <CardContent className="pt-4">
            <div className="animate-pulse space-y-3">
              <div className="flex gap-4 border-b border-border/60 pb-3">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="h-3 flex-1 rounded bg-muted" />
                ))}
              </div>
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i} className="flex gap-4 py-1.5">
                  <div className="h-4 w-28 rounded bg-muted" />
                  <div className="h-4 flex-1 rounded bg-muted" />
                  <div className="h-4 w-24 rounded bg-muted" />
                  <div className="h-4 w-16 rounded bg-muted" />
                  <div className="h-4 w-16 rounded bg-muted" />
                  <div className="h-4 w-20 rounded bg-muted" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
