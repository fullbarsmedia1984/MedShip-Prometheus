'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useSidebar } from './SidebarContext'
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  RefreshCw,
  List,
  AlertTriangle,
  Map,
  Settings,
  ChevronLeft,
  ChevronRight,
  Activity,
  X,
} from 'lucide-react'

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Orders', href: '/dashboard/orders', icon: ShoppingCart },
  { name: 'Inventory', href: '/dashboard/inventory', icon: Package },
  { name: 'Integrations', href: '/dashboard/integrations', icon: RefreshCw },
  { name: 'Event Log', href: '/dashboard/events', icon: List },
  { name: 'Failed Syncs', href: '/dashboard/failed', icon: AlertTriangle },
  { name: 'Field Mappings', href: '/dashboard/mappings', icon: Map },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const { isCollapsed, toggleSidebar, isMobileOpen, closeMobile } = useSidebar()

  const sidebarContent = (
    <div
      className={cn(
        'flex h-full flex-col bg-sidebar text-sidebar-foreground transition-all duration-300',
        isCollapsed ? 'w-[60px]' : 'w-[240px]'
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-sidebar-border px-4">
        {isCollapsed ? (
          <span className="mx-auto text-xl font-bold text-white">M</span>
        ) : (
          <div className="flex items-center">
            <span className="text-xl font-bold text-white">MedShip</span>
            <span className="ml-2 text-xl font-light text-sidebar-foreground/70">
              Prometheus
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-4">
        {navigation.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href)

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={closeMobile}
              className={cn(
                'group relative flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              {/* Active indicator — gold left border */}
              {isActive && (
                <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-sm bg-sidebar-primary" />
              )}
              <item.icon
                className={cn(
                  'h-5 w-5 flex-shrink-0',
                  isCollapsed ? 'mx-auto' : 'mr-3',
                  isActive
                    ? 'text-sidebar-primary'
                    : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground'
                )}
              />
              {!isCollapsed && <span>{item.name}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-sidebar-border px-2 py-2">
        <button
          onClick={toggleSidebar}
          className="flex w-full items-center justify-center rounded-md p-2 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronRight className="h-5 w-5" />
          ) : (
            <ChevronLeft className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* Footer */}
      {!isCollapsed && (
        <div className="border-t border-sidebar-border px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-sidebar-foreground/50">
            <Activity className="h-3.5 w-3.5" />
            <span>MedShip Prometheus v0.1</span>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex h-full flex-shrink-0">{sidebarContent}</aside>

      {/* Mobile overlay */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeMobile}
            aria-hidden="true"
          />
          {/* Sidebar drawer */}
          <aside className="relative z-50 flex h-full w-[240px]">
            <div className="flex h-full w-[240px] flex-col bg-sidebar text-sidebar-foreground">
              {/* Mobile close button */}
              <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
                <div className="flex items-center">
                  <span className="text-xl font-bold text-white">MedShip</span>
                  <span className="ml-2 text-xl font-light text-sidebar-foreground/70">
                    Prometheus
                  </span>
                </div>
                <button
                  onClick={closeMobile}
                  className="rounded-md p-1 text-sidebar-foreground/50 hover:text-sidebar-foreground"
                  aria-label="Close sidebar"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Mobile navigation */}
              <nav className="flex-1 space-y-1 px-2 py-4">
                {navigation.map((item) => {
                  const isActive =
                    item.href === '/dashboard'
                      ? pathname === '/dashboard'
                      : pathname.startsWith(item.href)

                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={closeMobile}
                      className={cn(
                        'group relative flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                      )}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-sm bg-sidebar-primary" />
                      )}
                      <item.icon
                        className={cn(
                          'mr-3 h-5 w-5 flex-shrink-0',
                          isActive
                            ? 'text-sidebar-primary'
                            : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground'
                        )}
                      />
                      <span>{item.name}</span>
                    </Link>
                  )
                })}
              </nav>

              {/* Mobile footer */}
              <div className="border-t border-sidebar-border px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-sidebar-foreground/50">
                  <Activity className="h-3.5 w-3.5" />
                  <span>MedShip Prometheus v0.1</span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
