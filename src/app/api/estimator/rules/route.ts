import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getPackingRules, savePackingRules } from '@/lib/estimator/repositories'

const rulesSchema = z.object({
  fill_factor: z.number().min(0.1).max(1),
  max_box_weight_lb: z.number().positive(),
  dim_divisor: z.number().positive(),
  segregate_liquids: z.boolean(),
  parcel_max: z.object({
    single_package_weight_lb: z.number().positive(),
    max_length_in: z.number().positive(),
    max_length_plus_girth_in: z.number().positive(),
  }),
  ltl_triggers: z.object({
    total_billable_weight_lb: z.number().positive(),
    carton_count: z.number().int().positive(),
    dim_weight_flag_threshold_lb: z.number().positive(),
  }),
  pallet: z.object({
    length_in: z.number().positive(),
    width_in: z.number().positive(),
    deck_height_in: z.number().positive(),
    deck_weight_lb: z.number().positive(),
    max_height_in: z.number().positive(),
    max_weight_lb: z.number().positive(),
    max_piece_weight_lb: z.number().positive(),
    stack_fill_factor: z.number().min(0.1).max(1),
  }),
  llm_confidence_threshold: z.number().min(0).max(1),
  estimate_confidence_threshold: z.number().min(0).max(1),
})

export async function GET() {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const rules = await getPackingRules()
    return NextResponse.json({ rules })
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

    const parsed = rulesSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: `Invalid rules payload: ${parsed.error.issues[0]?.message}` },
        { status: 400 }
      )
    }

    const updatedBy = auth.user?.email ?? (auth.isDevBypass ? 'dev-bypass' : null)
    await savePackingRules(parsed.data, updatedBy)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
