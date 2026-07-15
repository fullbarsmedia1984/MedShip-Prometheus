import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { resolveActiveSupplierCosts } from '@/lib/pricing/contract-migration'

function queryParam(request: NextRequest, name: string) {
  const value = request.nextUrl.searchParams.get(name)
  return value && value.trim() ? value.trim() : null
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const limitParam = queryParam(request, 'limit')
    const result = await resolveActiveSupplierCosts({
      supplierContractId: queryParam(request, 'supplierContractId'),
      supplierName: queryParam(request, 'supplierName'),
      internalItemId: queryParam(request, 'internalItemId'),
      distributorSku: queryParam(request, 'distributorSku'),
      manufacturerPartNumber: queryParam(request, 'manufacturerPartNumber'),
      gtin: queryParam(request, 'gtin'),
      priceUom: queryParam(request, 'priceUom'),
      asOfDate: queryParam(request, 'asOfDate'),
      limit: limitParam ? Number(limitParam) : null,
    })

    return NextResponse.json({ activeSupplierCosts: result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
