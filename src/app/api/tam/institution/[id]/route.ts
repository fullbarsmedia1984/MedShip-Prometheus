import { NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getTamInstitution } from '@/lib/tam/supabase'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const { id } = await params
    const institution = await getTamInstitution(id)

    if (!institution) {
      return NextResponse.json({ error: 'Institution not found' }, { status: 404 })
    }

    return NextResponse.json({ institution })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
