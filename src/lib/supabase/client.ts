import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  // NEXT_PUBLIC_ vars are replaced at build time by Next.js.
  // In production, the real Supabase URL is inlined here.
  // The fallback handles prerendering during build when vars may be absent.
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key'

  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}
