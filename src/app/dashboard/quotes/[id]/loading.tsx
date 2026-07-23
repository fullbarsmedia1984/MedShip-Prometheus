import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'

export default function QuoteDetailLoading() {
  return (
    <>
      <Header title="Quote Details" />
      <main className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="h-8 w-24 animate-pulse rounded-md bg-muted" />
        </div>

        <div className="space-y-6">
          {/* Summary metrics skeleton */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Card key={index} className="shadow-sm">
                <CardContent className="flex items-center gap-3">
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-[0.625rem] bg-muted" />
                  <div className="min-w-0 flex-1 animate-pulse space-y-2">
                    <div className="h-3 w-16 rounded-md bg-muted" />
                    <div className="h-6 w-24 rounded-md bg-muted" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>

          {/* Quote summary skeleton */}
          <Card className="shadow-sm">
            <CardContent className="pt-6">
              <div className="grid animate-pulse grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 9 }).map((_, index) => (
                  <div key={index} className="space-y-2">
                    <div className="h-3 w-20 rounded-md bg-muted" />
                    <div className="h-4 w-32 rounded-md bg-muted" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}
