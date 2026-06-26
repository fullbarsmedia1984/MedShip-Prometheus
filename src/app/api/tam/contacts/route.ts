import { NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { parseContactListParams } from '@/lib/tam/api'
import { listTamContacts } from '@/lib/tam/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const params = parseContactListParams(new URL(request.url).searchParams)
    const payload = await listTamContacts(params)

    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
