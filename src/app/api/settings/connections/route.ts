import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SystemName } from '@/types'

const VALID_SYSTEMS: SystemName[] = ['salesforce', 'fishbowl', 'quickbooks', 'easypost']

/**
 * Save connection credentials for an external system.
 * Stores config in the connection_configs table.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { system, config } = body as { system: string; config: Record<string, string> }

    if (!system || !VALID_SYSTEMS.includes(system as SystemName)) {
      return NextResponse.json(
        { error: `Invalid system. Must be one of: ${VALID_SYSTEMS.join(', ')}` },
        { status: 400 }
      )
    }

    if (!config || typeof config !== 'object') {
      return NextResponse.json(
        { error: 'Config object is required' },
        { status: 400 }
      )
    }

    // Filter out empty values
    const filteredConfig: Record<string, string> = {}
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && value.trim()) {
        filteredConfig[key] = value.trim()
      }
    }

    if (Object.keys(filteredConfig).length === 0) {
      return NextResponse.json(
        { error: 'At least one non-empty field is required' },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    const { error } = await supabase
      .from('connection_configs')
      .upsert(
        {
          system_name: system,
          config: filteredConfig,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'system_name' }
      )

    if (error) {
      console.error('Failed to save connection config:', error)
      return NextResponse.json(
        { error: 'Failed to save credentials', detail: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      system,
      fieldsUpdated: Object.keys(filteredConfig).length,
    })
  } catch (error) {
    console.error('Settings API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
