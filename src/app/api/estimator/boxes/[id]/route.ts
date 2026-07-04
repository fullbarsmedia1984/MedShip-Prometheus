import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { deleteStandardBox, updateStandardBox } from '@/lib/estimator/repositories'

type BoxContext = {
  params: Promise<{ id: string }>
}

const patchSchema = z
  .object({
    name: z.string().min(1),
    inner_length_in: z.number().positive(),
    inner_width_in: z.number().positive(),
    inner_height_in: z.number().positive(),
    outer_length_in: z.number().positive(),
    outer_width_in: z.number().positive(),
    outer_height_in: z.number().positive(),
    box_weight_lb: z.number().min(0),
    max_content_weight_lb: z.number().positive(),
    active: z.boolean(),
  })
  .partial()

export async function PATCH(request: NextRequest, context: BoxContext) {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Invalid box payload: ${parsed.error.issues[0]?.message}` },
        { status: 400 }
      )
    }

    await updateStandardBox(id, parsed.data)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function DELETE(_request: NextRequest, context: BoxContext) {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const { id } = await context.params
    await deleteStandardBox(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
