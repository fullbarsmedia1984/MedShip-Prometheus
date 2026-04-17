'use client'

import { cn } from '@/lib/utils'
import { useSidebar } from './SidebarContext'
import { useTheme } from 'next-themes'
import { Bell, Sun, Moon, Menu, Search } from 'lucide-react'

interface HeaderProps {
  title: string
  failedSyncCount?: number
}

export function Header({ title, failedSyncCount = 0 }: HeaderProps) {
  const { toggleMobile } = useSidebar()
  const { theme, setTheme } = useTheme()

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

        {/* User avatar */}
        <div className="ml-2 flex items-center gap-2">
          <img
            src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 36 36'%3E%3Ccircle cx='18' cy='18' r='18' fill='%231C3C6E'/%3E%3Ctext x='18' y='24' font-family='Outfit,sans-serif' font-size='16' font-weight='600' fill='white' text-anchor='middle'%3EA%3C/text%3E%3C/svg%3E"
            alt="Admin"
            className="h-10 w-10 rounded-full"
          />
        </div>
      </div>
    </header>
  )
}
