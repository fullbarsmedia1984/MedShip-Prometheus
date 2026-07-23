import { Header } from '@/components/layout/Header'
import { Card, CardContent } from '@/components/ui/card'

export default function QuotesLoading() {
  return (
    <>
      <Header title="Quotes" />
      <main className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {/* Summary stats skeleton */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="shadow-sm">
              <CardContent className="pt-4">
                <div className="animate-pulse space-y-3">
                  <div className="h-4 w-24 rounded-md bg-muted" />
                  <div className="h-7 w-32 rounded-md bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters bar skeleton */}
        <Card className="shadow-sm">
          <CardContent className="pt-4">
            <div className="flex animate-pulse flex-wrap items-center gap-3">
              <div className="h-9 w-full rounded-md bg-muted sm:w-72" />
              <div className="h-9 w-full rounded-md bg-muted sm:w-52" />
              <div className="h-9 w-full rounded-md bg-muted sm:w-44" />
            </div>
          </CardContent>
        </Card>

        {/* Table skeleton */}
        <Card className="shadow-sm">
          <CardContent className="pt-4">
            <div className="animate-pulse space-y-3">
              <div className="h-9 rounded-md bg-muted" />
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="h-8 rounded-md bg-muted/60" />
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
