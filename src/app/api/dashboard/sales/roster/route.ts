import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { STAFF_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { SALES_DASHBOARD_CACHE_TAG } from '@/lib/data'
import { createAdminClient } from '@/lib/supabase/admin'

type RosterRequest = {
  selectedAliases?: unknown
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireApiAuth(STAFF_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = (await request.json()) as RosterRequest
    if (!Array.isArray(body.selectedAliases)) {
      return NextResponse.json({ error: 'selectedAliases must be an array' }, { status: 400 })
    }

    const selectedAliases = body.selectedAliases
      .filter((alias): alias is string => typeof alias === 'string')
      .map((alias) => alias.trim())
      .filter(Boolean)

    if (selectedAliases.length === 0) {
      return NextResponse.json({ error: 'Select at least one sales rep alias' }, { status: 400 })
    }

    const uniqueAliases = [...new Set(selectedAliases)]
    const supabase = createAdminClient()

    const { data: existingRows, error: readError } = await supabase
      .from('fishbowl_salesperson_aliases')
      .select('fishbowl_salesperson, is_house_account, is_system_alias')
      .in('fishbowl_salesperson', uniqueAliases)

    if (readError) throw readError

    const existingAliases = new Set((existingRows ?? [])
      .filter((row) => !row.is_house_account && !row.is_system_alias)
      .map((row) => row.fishbowl_salesperson))
    const invalidAliases = uniqueAliases.filter((alias) => !existingAliases.has(alias))

    if (invalidAliases.length > 0) {
      return NextResponse.json(
        { error: `Invalid roster aliases: ${invalidAliases.join(', ')}` },
        { status: 400 }
      )
    }

    const reset = await supabase
      .from('fishbowl_salesperson_aliases')
      .update({ show_on_sales_dashboard: false, dashboard_sort_order: null })
      .eq('is_house_account', false)
      .eq('is_system_alias', false)

    if (reset.error) throw reset.error

    for (const [index, alias] of uniqueAliases.entries()) {
      const { error } = await supabase
        .from('fishbowl_salesperson_aliases')
        .update({
          show_on_sales_dashboard: true,
          dashboard_sort_order: (index + 1) * 10,
        })
        .eq('fishbowl_salesperson', alias)

      if (error) throw error
    }

    revalidateTag(SALES_DASHBOARD_CACHE_TAG, { expire: 0 })

    return NextResponse.json({ selectedAliases: uniqueAliases })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
