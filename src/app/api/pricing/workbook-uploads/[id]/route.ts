import { NextResponse } from 'next/server'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getWorkbookUpload, listDistributorProfiles } from '@/lib/pricing/excel-ingestion'

type UploadContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: UploadContext) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const upload = await getWorkbookUpload(id)
    if (!upload) return NextResponse.json({ error: 'Upload not found.' }, { status: 404 })

    const profiles = await listDistributorProfiles(String(upload.distributor_name ?? '') || null)
    return NextResponse.json({ upload, profiles })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
