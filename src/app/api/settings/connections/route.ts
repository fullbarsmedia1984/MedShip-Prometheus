import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ADMIN_API_AUTH_OPTIONS, SUPERADMIN_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import type { SystemName } from '@/types'

const VALID_SYSTEMS: SystemName[] = ['salesforce', 'fishbowl', 'quickbooks', 'easypost']

type ConnectionConfigRow = {
  config?: unknown
  system_name?: unknown
  configured_fields?: string[]
  locked_fields?: string[]
  optional_locked_fields?: string[]
  [key: string]: unknown
}

const ENV_FIELD_MAP: Record<string, Record<string, string>> = {
  salesforce: {
    loginUrl: 'SF_LOGIN_URL',
    clientId: 'SF_CLIENT_ID',
    clientSecret: 'SF_CLIENT_SECRET',
    username: 'SF_USERNAME',
    password: 'SF_PASSWORD',
  },
  fishbowl: {
    apiUrl: 'FISHBOWL_API_URL',
    username: 'FISHBOWL_USERNAME',
    password: 'FISHBOWL_PASSWORD',
  },
}

/**
 * Fetch all saved connection configs from Supabase.
 * Returns metadata only; raw credentials are never sent to the browser.
 */
export async function GET() {
  try {
    const auth = await requireApiAuth(ADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('connection_configs')
      .select('*')
      .order('system_name')

    if (error) {
      console.error('Failed to fetch connection configs:', error)
      return NextResponse.json(
        { error: 'Failed to fetch configs', detail: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json(withEnvironmentBackedConfigs(data ?? []))
  } catch (error) {
    console.error('Settings API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * Save connection credentials for an external system.
 * Stores config in the connection_configs table.
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireApiAuth(SUPERADMIN_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

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
    const { data: existingConfig } = await supabase
      .from('connection_configs')
      .select('config')
      .eq('system_name', system)
      .maybeSingle()

    const { error } = await supabase
      .from('connection_configs')
      .upsert(
        {
          system_name: system,
          config: {
            ...toStringRecord(existingConfig?.config),
            ...filteredConfig,
          },
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

function redactConnectionConfig(row: ConnectionConfigRow) {
  const config = toStringRecord(row.config)
  const envFields = getEnvironmentConfiguredFields(String(row.system_name ?? ''))
  const optionalLockedFields = getEnvironmentManagedOptionalFields(String(row.system_name ?? ''))
  const lockedFields = [...new Set([...envFields, ...optionalLockedFields])].sort()
  const configuredFields = [...new Set([...Object.keys(config), ...envFields])].sort()

  return {
    ...row,
    config: {},
    configured_fields: configuredFields,
    locked_fields: lockedFields,
    optional_locked_fields: optionalLockedFields,
    credential_source: envFields.length > 0 ? 'environment' : 'database',
  }
}

function withEnvironmentBackedConfigs(rows: ConnectionConfigRow[]) {
  const bySystem = new Map<string, ConnectionConfigRow>()
  for (const row of rows) {
    if (typeof row.system_name === 'string') {
      bySystem.set(row.system_name, row)
    }
  }

  for (const system of Object.keys(ENV_FIELD_MAP)) {
    const envFields = getEnvironmentConfiguredFields(system)
    if (envFields.length === 0 || bySystem.has(system)) continue

    bySystem.set(system, {
      id: `env-${system}`,
      system_name: system,
      config: {},
      is_active: true,
      last_connected_at: null,
      last_error: null,
      created_at: null,
      updated_at: null,
    })
  }

  return Array.from(bySystem.values())
    .map(redactConnectionConfig)
    .sort((a, b) =>
      String(a.system_name ?? '').localeCompare(String(b.system_name ?? ''))
    )
}

function getEnvironmentConfiguredFields(system: string) {
  const fieldMap = ENV_FIELD_MAP[system]
  if (!fieldMap) return []

  return Object.entries(fieldMap)
    .filter(([, envName]) => Boolean(process.env[envName]))
    .map(([fieldName]) => fieldName)
}

function getEnvironmentManagedOptionalFields(system: string) {
  if (system !== 'salesforce') return []

  const hasUsernameTokenAuth = Boolean(
    process.env.SF_USERNAME &&
      process.env.SF_PASSWORD &&
      process.env.SF_SECURITY_TOKEN
  )

  if (!hasUsernameTokenAuth) return []

  return ['clientId', 'clientSecret'].filter((fieldName) => {
    const envName = ENV_FIELD_MAP.salesforce[fieldName]
    return envName && !process.env[envName]
  })
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const record: Record<string, string> = {}
  for (const [key, fieldValue] of Object.entries(value)) {
    if (typeof fieldValue === 'string') {
      record[key] = fieldValue
    }
  }
  return record
}
