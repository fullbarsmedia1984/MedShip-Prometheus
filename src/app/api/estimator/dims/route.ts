import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { searchVerifiedDims, upsertVerifiedDims } from '@/lib/estimator/repositories'

const upsertSchema = z.object({
  fishbowlPartNumber: z.string().min(1),
  lengthIn: z.number().positive(),
  widthIn: z.number().positive(),
  heightIn: z.number().positive(),
  weightLb: z.number().min(0),
  shipsInOwnCarton: z.boolean().default(false),
  attributes: z.record(z.string(), z.unknown()).default({}),
  source: z.enum(['manufacturer_site', 'physical_measurement', 'fishbowl_confirmed']),
  sourceUrl: z.string().nullable().default(null),
  llmSuggested: z.boolean().default(false),
})

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const search = request.nextUrl.searchParams.get('search') ?? undefined
    const dims = await searchVerifiedDims(search)
    return NextResponse.json({ dims })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const parsed = upsertSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Invalid dims payload: ${parsed.error.issues[0]?.message}` },
        { status: 400 }
      )
    }

    const verifiedBy = auth.user?.email ?? (auth.isDevBypass ? 'dev-bypass' : null)
    await upsertVerifiedDims({ ...parsed.data, verifiedBy })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
