import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getRepAliases } from '@/lib/reps'
import { getQuotes } from '@/lib/data'

type QuoteDetailContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: QuoteDetailContext) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const decodedId = decodeURIComponent(id)
    // Reps may only open their own quotes (404, not 403, to avoid confirming
    // that a given quote number exists).
    const repScope =
      auth.role === 'sales_rep' && auth.user
        ? await getRepAliases(auth.user.id)
        : undefined
    const result = await getQuotes({
      search: decodedId,
      scope: 'all',
      salespersonIn: repScope,
      pageSize: 1000,
    })
    const quote = result.data.find((item) => item.id === decodedId)

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
