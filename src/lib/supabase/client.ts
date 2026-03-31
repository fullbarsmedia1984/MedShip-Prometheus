import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  // NEXT_PUBLIC_ vars are inlined at build time by Next.js.
  // They MUST be set in the Railway environment before building.
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
