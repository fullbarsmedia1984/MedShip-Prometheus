'use client'

import { cn } from '@/lib/utils'
import { useSidebar } from './SidebarContext'
import { useTheme } from 'next-themes'
import { Bell, Sun, Moon, Menu } from 'lucide-react'

interface HeaderProps {
  title: string
  failedSyncCount?: number
}

export function Header({ title, failedSyncCount = 0 }: HeaderProps) {
  const { toggleMobile } = useSidebar()
  const { theme, setTheme } = useTheme()

  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-4 md:px-6">
      {/* Left: mobile hamburger + title */}
      <div className="flex items-center gap-3">
        <button
          onClick={toggleMobile}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        {/* Notification bell */}
        <button
          className="relative rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {failedSyncCount > 0 && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white'
              )}
            >
              {failedSyncCount > 99 ? '99+' : failedSyncCount}
            </span>
          )}
        </button>

        {/* Dark/light mode toggle */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <Sun className="h-5 w-5" />
          ) : (
            <Moon className="h-5 w-5" />
          )}
        </button>

        {/* User avatar */}
        <div className="flex items-center gap-2 rounded-md px-2 py-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
            A
          </div>
          <span className="hidden text-sm font-medium text-foreground md:inline">
            Admin
          </span>
        </div>
      </div>
    </header>
  )
}
