'use client'

import { createContext, useContext } from 'react'

export type AuthInfo = {
  email: string | null
  role: string | null
}

const AuthInfoContext = createContext<AuthInfo | null>(null)

// The dashboard layout already resolved the session server-side; this hands
// the account identity to client components (Header) so they don't each make
// their own supabase.auth.getUser() round-trip on mount.
export function AuthInfoProvider({
  value,
  children,
}: {
  value: AuthInfo
  children: React.ReactNode
}) {
  return (
    <AuthInfoContext.Provider value={value}>{children}</AuthInfoContext.Provider>
  )
}

export function useAuthInfo() {
  return useContext(AuthInfoContext)
}
