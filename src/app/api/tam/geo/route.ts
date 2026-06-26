import { NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { parseInstitutionFilters, parseTamScenario } from '@/lib/tam/api'
import { getTamByStateDollars, listTamGeo } from '@/lib/tam/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const searchParams = new URL(request.url).searchParams
    const scenario = parseTamScenario(searchParams.get('scenario'))
    const filters = parseInstitutionFilters(searchParams)
    const [institutions, states] = await Promise.all([
      listTamGeo(filters),
      getTamByStateDollars(scenario),
    ])

    return NextResponse.json({ scenario, institutions, states })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
