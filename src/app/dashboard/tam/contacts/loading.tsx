import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'

/** Instant skeleton for the TAM contacts browser while the server page fetches. */
export default function TamContactsLoading() {
  return (
    <div className="flex flex-col">
      <Header title="TAM Contacts" />
      <main className="space-y-6 p-4 md:p-6">
        <div className="animate-pulse space-y-2">
          <div className="h-6 w-48 rounded bg-muted" />
          <div className="h-4 w-96 max-w-full rounded bg-muted" />
        </div>

        {/* Filter card placeholder */}
        <Card>
          <CardContent className="animate-pulse space-y-4 pt-6">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <div className="h-8 rounded-lg bg-muted xl:col-span-2" />
              <div className="h-8 rounded-lg bg-muted" />
              <div className="h-8 rounded-lg bg-muted" />
              <div className="h-8 rounded-lg bg-muted" />
              <div className="h-8 rounded-lg bg-muted" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="h-4 w-36 rounded bg-muted" />
              <div className="h-8 w-56 rounded-lg bg-muted" />
            </div>
          </CardContent>
        </Card>

        {/* Table placeholder */}
        <Card>
          <CardContent className="animate-pulse space-y-3 p-6">
            <div className="flex gap-4 border-b border-border/60 pb-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-3 flex-1 rounded bg-muted" />
              ))}
            </div>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="flex gap-4 py-1.5">
                <div className="h-4 flex-[2] rounded bg-muted" />
                <div className="h-4 w-20 rounded bg-muted" />
                <div className="h-4 flex-[2] rounded bg-muted" />
                <div className="h-4 flex-[2] rounded bg-muted" />
                <div className="h-4 flex-1 rounded bg-muted" />
                <div className="h-4 flex-1 rounded bg-muted" />
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
