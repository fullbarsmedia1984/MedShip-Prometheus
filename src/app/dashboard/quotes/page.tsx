import { SALES_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import {
  QUOTES_DEFAULT_PAGE_SIZE,
  buildQuoteFilters,
  getQuotesDashboardPayload,
  type QuotesDashboardPayload,
} from '@/lib/quotes-payload'
import { resolveRepScope } from '@/lib/sales-scope'
import { QuotesPageClient } from './QuotesPageClient'

// Server-rendered first paint: fetch the payload for the DEFAULT filter state
// (the exact state the client component mounts with) using the same shared
// filter/scoping helpers as /api/dashboard/quotes, so page and route cannot
// drift. All subsequent filter interactions use the client fetch path.
export default async function QuotesPage() {
  const auth = await requireDashboardAuth(SALES_API_AUTH_OPTIONS)

  let initialData: QuotesDashboardPayload | undefined
  try {
    const repScope = await resolveRepScope(auth.role, auth.user)
    initialData = await getQuotesDashboardPayload(
      buildQuoteFilters({}, repScope),
      1,
      QUOTES_DEFAULT_PAGE_SIZE
    )
  } catch {
    // If the server-side fetch fails, fall back to the client's original
    // fetch-on-mount behavior instead of crashing the page.
  }

  return <QuotesPageClient initialData={initialData} />
}
