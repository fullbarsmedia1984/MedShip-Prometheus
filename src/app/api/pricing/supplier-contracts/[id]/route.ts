import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getSupplierContract, listContractCostLines } from '@/lib/pricing/contract-costs'
import type { CostLineStatusFilter } from '@/lib/pricing/contract-costs'

type ContractContext = {
  params: Promise<{ id: string }>
}

const STATUS_FILTERS: CostLineStatusFilter[] = ['active', 'pending', 'superseded', 'rolled_back', 'all']

export async function GET(request: NextRequest, context: ContractContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const contract = await getSupplierContract(id)
    if (!contract) return NextResponse.json({ error: 'Contract not found.' }, { status: 404 })

    const statusParam = request.nextUrl.searchParams.get('status') as CostLineStatusFilter | null
    const status = statusParam && STATUS_FILTERS.includes(statusParam) ? statusParam : 'active'
    const costLines = await listContractCostLines(id, status)

    return NextResponse.json({ contract, costLines, statusFilter: status })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
