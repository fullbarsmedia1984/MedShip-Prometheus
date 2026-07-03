import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { buildMigrationPublishPreview } from '@/lib/pricing/contract-migration'

type PublishPreviewContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: PublishPreviewContext) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const preview = await buildMigrationPublishPreview(id)
    return NextResponse.json({ preview })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    )
  }
}
