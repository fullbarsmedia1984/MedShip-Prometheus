import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { saveDistributorProfile } from '@/lib/pricing/excel-ingestion'
import type { NativeProfileInput } from '@/lib/pricing/excel-ingestion'

type ProfileContext = {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, context: ProfileContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const body = (await request.json().catch(() => ({}))) as Partial<NativeProfileInput>
    if (!body.sheetName || !body.headerRow || !Array.isArray(body.columnMappings)) {
      return NextResponse.json(
        { error: 'sheetName, headerRow, and columnMappings are required.' },
        { status: 400 }
      )
    }

    const profile = await saveDistributorProfile(
      id,
      {
        profileName: body.profileName ?? null,
        sheetName: body.sheetName,
        headerRow: body.headerRow,
        dataStartRow: body.dataStartRow ?? null,
        defaultPriceUom: body.defaultPriceUom ?? null,
        columnMappings: body.columnMappings,
      },
      auth.user?.id ?? null
    )

    return NextResponse.json({ profile })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
