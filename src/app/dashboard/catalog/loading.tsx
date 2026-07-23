import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'

/** Instant skeleton for the supplier catalog while the server page fetches. */
export default function CatalogLoading() {
  return (
    <div className="flex h-full flex-col">
      <Header title="Supplier Catalog" />

      <main className="flex-1 space-y-4 overflow-y-auto p-4 md:p-6">
        {/* Search + filter toolbar placeholder */}
        <Card className="shadow-sm">
          <CardContent className="animate-pulse space-y-3 p-4">
            <div className="h-11 rounded-md bg-muted" />
            <div className="flex flex-wrap items-center gap-2">
              <div className="h-8 w-full rounded-md bg-muted sm:w-44" />
              <div className="h-8 w-full rounded-md bg-muted sm:w-52" />
              <div className="h-8 w-full rounded-md bg-muted sm:w-56" />
              <div className="h-8 w-full rounded-md bg-muted sm:ml-auto sm:w-44" />
            </div>
          </CardContent>
        </Card>

        {/* Results placeholder — matches the client's SkeletonRow shape */}
        <Card className="shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-xs text-muted-foreground">Searching…</span>
          </div>
          {Array.from({ length: 8 }, (_, i) => (
            <div
              key={i}
              className="flex animate-pulse items-start gap-4 border-b border-border/60 px-4 py-3.5 last:border-b-0"
            >
              <div className="h-16 w-16 rounded-lg bg-muted" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-3.5 w-3/4 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
                <div className="h-3 w-1/3 rounded bg-muted" />
              </div>
            </div>
          ))}
        </Card>
      </main>
    </div>
  )
}
