import { createAdminClient } from '@/lib/supabase/admin'

export type DataSourceMode = 'seed' | 'live'

// Cache the setting in memory for 30 seconds to avoid hammering the DB
let cachedMode: { value: DataSourceMode; expires: number } | null = null

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

    const mode: DataSourceMode = data?.value ?? 'seed'
    cachedMode = { value: mode, expires: Date.now() + 30_000 }
    return mode
  } catch {
    // If Supabase is not configured or table doesn't exist, default to seed
    return 'seed'
  }
}

export async function setDataSourceMode(mode: DataSourceMode): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from('app_settings')
    .upsert({
      key: 'data_source_mode',
      value: JSON.stringify(mode),
      updated_at: new Date().toISOString(),
    })
  cachedMode = null // Invalidate cache
}

export function clearDataSourceCache() {
  cachedMode = null
}
