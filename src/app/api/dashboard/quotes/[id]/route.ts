import { NextRequest, NextResponse } from 'next/server'
import { SALES_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { resolveRepScope } from '@/lib/sales-scope'
import { getScopedQuoteById } from '@/lib/quotes-payload'

type QuoteDetailContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: QuoteDetailContext) {
  try {
    const auth = await requireApiAuth(SALES_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    // Reps may only open their own quotes — getScopedQuoteById resolves
    // out-of-scope rows to null so this surfaces 404, not 403 (avoids
    // confirming that a given quote number exists).
    const repScope = await resolveRepScope(auth.role, auth.user)
    const quote = await getScopedQuoteById(id, repScope)

    if (!quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    }

    return NextResponse.json({ quote })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
