import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { createWorkbookUpload, listWorkbookUploads } from '@/lib/pricing/excel-ingestion'

export async function GET() {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const uploads = await listWorkbookUploads()
    return NextResponse.json({ uploads })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A workbook file is required.' }, { status: 400 })
    }

    const text = (name: string) => {
      const value = form.get(name)
      return typeof value === 'string' ? value : null
    }

    const result = await createWorkbookUpload({
      fileName: file.name,
      fileBytes: Buffer.from(await file.arrayBuffer()),
      metadata: {
        distributorName: text('distributorName') ?? '',
        contractNumber: text('contractNumber') ?? '',
        effectiveDate: text('effectiveDate') ?? '',
        expirationDate: text('expirationDate'),
        accountNumber: text('accountNumber'),
        locationScope: text('locationScope'),
        notes: text('notes'),
      },
      actorId: auth.user?.id ?? null,
    })

    return NextResponse.json({ upload: result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
