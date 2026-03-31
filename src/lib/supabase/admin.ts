import { createClient } from '@supabase/supabase-js'

// Service role client for background jobs - bypasses RLS
// IMPORTANT: Only use this server-side, never expose to browser
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // During build/prerendering, env vars may not be available
  if (!supabaseUrl || !serviceRoleKey) {
    // Return a placeholder client that will fail gracefully at runtime
    return createClient('https://placeholder.supabase.co', 'placeholder-key', {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
