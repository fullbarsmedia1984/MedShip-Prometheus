import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { inngest } from '@/inngest'
import { ADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import {
  getIncentiveSettings,
  updateIncentiveSettings,
  validateIncentiveSettings,
} from '@/lib/incentive/settings'
import { INCENTIVE_CACHE_TAG } from '@/lib/incentive/queries'
import type { IncentiveSettings } from '@/lib/incentive/types'

const PATCHABLE_KEYS: Array<keyof IncentiveSettings> = [
  'promoStart',
  'promoEnd',
  'enrollmentGate',
  'baseRate',
  'bonusRate',
  'newWindowDays',
  'winBackGapDays',
]

// Changes to these alter classification/qualification, not just display —
// they require a recompute.
const RECOMPUTE_KEYS: Array<keyof IncentiveSettings> = [
  'promoStart',
  'promoEnd',
  'enrollmentGate',
  'newWindowDays',
  'winBackGapDays',
]

export async function GET() {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    return NextResponse.json({ settings: await getIncentiveSettings() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = (await request.json()) as Partial<IncentiveSettings>
    const patch: Partial<IncentiveSettings> = {}
    for (const key of PATCHABLE_KEYS) {
      if (body[key] !== undefined) {
        // @ts-expect-error -- key-correlated assignment; validated below
        patch[key] = body[key]
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No recognized settings in request body' }, { status: 400 })
    }

    const current = await getIncentiveSettings()
    const candidate = { ...current, ...patch }
    const errors = validateIncentiveSettings(candidate)
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
    }

    const settings = await updateIncentiveSettings(patch)
    revalidateTag(INCENTIVE_CACHE_TAG, { expire: 0 })

    if (RECOMPUTE_KEYS.some((key) => patch[key] !== undefined && patch[key] !== current[key])) {
      await inngest.send({ name: 'incentive/recompute', data: { triggeredBy: 'settings-edit' } })
    }

    return NextResponse.json({ success: true, settings })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
