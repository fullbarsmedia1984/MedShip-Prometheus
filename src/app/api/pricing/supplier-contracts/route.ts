import { NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { listSupplierContracts } from '@/lib/pricing/contract-costs'

export async function GET() {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const contracts = await listSupplierContracts()
    return NextResponse.json({ contracts })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
