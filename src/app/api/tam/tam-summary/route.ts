import { NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getTamSummary } from '@/lib/tam/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const scenarios = await getTamSummary()

    return NextResponse.json({ scenarios })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
