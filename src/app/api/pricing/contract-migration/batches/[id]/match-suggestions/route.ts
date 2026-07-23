import { NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import {
  generateItemMatchSuggestions,
  getBatchItemMatchOverview,
  getBatchItemMatchStats,
} from '@/lib/pricing/item-matching'

type MatchSuggestionsContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: MatchSuggestionsContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    // Single-pass read: stats are derived from the same cost-line and
    // suggestion queries the list needs, so nothing runs twice.
    const { stats, suggestions } = await getBatchItemMatchOverview(id)
    return NextResponse.json({ stats, suggestions })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}

export async function POST(_request: Request, context: MatchSuggestionsContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const run = await generateItemMatchSuggestions(id)
    const stats = await getBatchItemMatchStats(id)
    return NextResponse.json({ run, stats })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
