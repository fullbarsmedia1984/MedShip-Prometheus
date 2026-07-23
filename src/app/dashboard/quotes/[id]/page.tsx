import { SALES_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import { getScopedQuoteById } from '@/lib/quotes-payload'
import { resolveRepScope } from '@/lib/sales-scope'
import type { SeedQuote } from '@/lib/seed-data'
import { QuoteDetailClient } from './QuoteDetailClient'

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>
}

// Server-rendered first paint: resolve the quote with the same shared
// scoping helper the detail API route uses (getScopedQuoteById +
// resolveRepScope), so a sales rep cannot see another rep's quote by direct
// navigation — out-of-scope rows render as "not found", never 403.
export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const { id } = await params
  const auth = await requireDashboardAuth(SALES_API_AUTH_OPTIONS)

  let initialQuote: SeedQuote | null | undefined
  try {
    const repScope = await resolveRepScope(auth.role, auth.user)
    initialQuote = await getScopedQuoteById(id, repScope)
  } catch {
    // If the server-side fetch fails, fall back to the client's original
    // fetch-on-mount behavior instead of crashing the page.
    initialQuote = undefined
  }

  return <QuoteDetailClient quoteId={id} initialQuote={initialQuote} />
}
