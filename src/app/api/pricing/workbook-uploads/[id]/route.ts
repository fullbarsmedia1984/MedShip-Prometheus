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
    // The profile list only depends on the upload's distributor name, so
    // fetch the (small, capped) unfiltered list in parallel with the upload
    // and narrow it here instead of waiting on two sequential round-trips.
    const [upload, allProfiles] = await Promise.all([
      getWorkbookUpload(id),
      listDistributorProfiles(null),
    ])
    if (!upload) return NextResponse.json({ error: 'Upload not found.' }, { status: 404 })

    const distributorName = String(upload.distributor_name ?? '') || null
    // listDistributorProfiles caps at 100 rows; if the unfiltered list hit
    // that cap a distributor's profiles could be truncated — fall back to the
    // filtered query in that rare case.
    const profiles = distributorName
      ? allProfiles.length < 100
        ? allProfiles.filter((profile) => profile.distributor_name === distributorName)
        : await listDistributorProfiles(distributorName)
      : allProfiles
    return NextResponse.json({ upload, profiles })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
