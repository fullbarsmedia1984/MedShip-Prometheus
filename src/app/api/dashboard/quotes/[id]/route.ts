import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
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
    const result = await getQuotes({ search: decodedId, scope: 'all', pageSize: 1000 })
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
