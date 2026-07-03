import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getMigrationBatch } from '@/lib/pricing/contract-migration'

type BatchContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, context: BatchContext) {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const batch = await getMigrationBatch(id)
    if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

    return NextResponse.json({ batch })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
