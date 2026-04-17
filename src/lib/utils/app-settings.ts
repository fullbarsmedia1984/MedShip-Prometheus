import { createAdminClient } from '@/lib/supabase/admin'

export type DataSourceMode = 'seed' | 'live'

// Cache the setting in memory for 30 seconds to avoid hammering the DB
let cachedMode: { value: DataSourceMode; expires: number } | null = null

/**
 * Parse the JSONB value which may be:
 * - A raw string: "seed" or "live" (Supabase auto-parses JSONB)
 * - A quoted JSON string: "\"seed\"" (if double-encoded on write)
 */
function parseMode(raw: unknown): DataSourceMode {
  if (typeof raw === 'string') {
    // Strip any extra quotes from double-encoding
    const cleaned = raw.replace(/^"|"$/g, '')
    if (cleaned === 'live') return 'live'
  }
  return 'seed'
}

export async function getDataSourceMode(): Promise<DataSourceMode> {
  if (cachedMode && cachedMode.expires > Date.now()) {
    return cachedMode.value
  }

  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'data_source_mode')
      .single()

    const mode = parseMode(data?.value)
    cachedMode = { value: mode, expires: Date.now() + 30_000 }
    return mode
  } catch {
    // If Supabase is not configured or table doesn't exist, default to seed
    return 'seed'
  }
}

export async function setDataSourceMode(mode: DataSourceMode): Promise<void> {
  const supabase = createAdminClient()
  // Store as a plain string in JSONB — no JSON.stringify to avoid double-encoding
  await supabase
    .from('app_settings')
    .upsert({
      key: 'data_source_mode',
      value: mode,
      updated_at: new Date().toISOString(),
    })
  cachedMode = null // Invalidate cache
}

export function clearDataSourceCache() {
  cachedMode = null
}
