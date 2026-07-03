import { NextResponse } from 'next/server'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { parseInstitutionListParams } from '@/lib/tam/api'
import { listTamInstitutions } from '@/lib/tam/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const params = parseInstitutionListParams(new URL(request.url).searchParams)
    const payload = await listTamInstitutions(params)

    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
