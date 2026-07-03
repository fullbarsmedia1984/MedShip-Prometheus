import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getStandardBoxes, upsertStandardBox } from '@/lib/estimator/repositories'

const boxSchema = z.object({
  name: z.string().min(1),
  inner_length_in: z.number().positive(),
  inner_width_in: z.number().positive(),
  inner_height_in: z.number().positive(),
  outer_length_in: z.number().positive(),
  outer_width_in: z.number().positive(),
  outer_height_in: z.number().positive(),
  box_weight_lb: z.number().min(0),
  max_content_weight_lb: z.number().positive(),
  active: z.boolean().default(true),
})

export async function GET() {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const boxes = await getStandardBoxes({ includeInactive: true })
    return NextResponse.json({ boxes })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const parsed = boxSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Invalid box payload: ${parsed.error.issues[0]?.message}` },
        { status: 400 }
      )
    }

    await upsertStandardBox(parsed.data)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
