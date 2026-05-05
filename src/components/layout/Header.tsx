'use client'

import { cn } from '@/lib/utils'
import { useSidebar } from './SidebarContext'
import { useTheme } from 'next-themes'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Bell, Sun, Moon, Menu, Search, ChevronDown, LogOut } from 'lucide-react'

interface HeaderProps {
  title: string
  failedSyncCount?: number
}

export function Header({ title, failedSyncCount = 0 }: HeaderProps) {
  const { toggleMobile } = useSidebar()
  const { theme, setTheme } = useTheme()
  const router = useRouter()
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [account, setAccount] = useState<{
    email: string
    role: string | null
  } | null>(null)

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getUser().then(({ data }) => {
      const user = data.user
      if (!user) return

      setAccount({
        email: user.email ?? 'Signed in',
        role:
          typeof user.app_metadata?.role === 'string'
            ? user.app_metadata.role
            : null,
      })
    })
  }, [])

  useEffect(() => {
    if (!menuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const initial = (account?.email?.[0] ?? 'A').toUpperCase()

  async function handleSignOut() {
    setSigningOut(true)

    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      await createClient().auth.signOut()
    } finally {
      setMenuOpen(false)
      setSigningOut(false)
      router.replace('/login')
      router.refresh()
    }
  }

  return (
    <header className="flex h-[4.375rem] items-center justify-between bg-background px-[2.1rem]">
      {/* Left: mobile hamburger + title */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleMobile}
          className="rounded-[0.625rem] p-2 text-muted-foreground hover:bg-card hover:text-foreground lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-medium text-foreground">{title}</h1>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1">
        {/* Search */}
        <div className="mr-2 hidden items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground lg:flex">
          <Search className="h-4 w-4" />
          <span>Search here...</span>
        </div>

        {/* Dark/light mode toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex h-10 w-10 items-center justify-center rounded-[0.625rem] text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </button>

        {/* Notification bell */}
        <button
          className="relative flex h-10 w-10 items-center justify-center rounded-[0.625rem] text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {failedSyncCount > 0 && (
            <span className="absolute right-1 top-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-medship-danger px-1 text-[0.625rem] font-bold text-white">
              {failedSyncCount > 99 ? '99+' : failedSyncCount}
            </span>
          )}
        </button>

        {/* User menu */}
        <div ref={menuRef} className="relative ml-2">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            className={cn(
              'flex h-10 items-center gap-2 rounded-[0.625rem] px-1.5 transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              menuOpen && 'bg-card'
            )}
            aria-label="Open account menu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1C3C6E] text-sm font-semibold text-white">
              {initial}
            </span>
            <ChevronDown
              className={cn(
                'hidden h-4 w-4 text-muted-foreground transition-transform sm:block',
                menuOpen && 'rotate-180'
              )}
            />
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-[0.625rem] border border-border bg-popover shadow-lg"
            >
              <div className="border-b border-border px-4 py-3">
                <p className="truncate text-sm font-medium text-popover-foreground">
                  {account?.email ?? 'Signed in'}
                </p>
                {account?.role && (
                  <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                    {account.role}
                  </p>
                )}
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={handleSignOut}
                disabled={signingOut}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-popover-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LogOut className="h-4 w-4" />
                {signingOut ? 'Signing out...' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
