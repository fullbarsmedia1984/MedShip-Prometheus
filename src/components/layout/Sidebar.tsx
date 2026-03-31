'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useSidebar } from './SidebarContext'
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
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

const mainNav = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Sales', href: '/dashboard/sales', icon: BarChart3 },
  { name: 'Orders', href: '/dashboard/orders', icon: ShoppingCart },
  { name: 'Inventory', href: '/dashboard/inventory', icon: Package },
]

const opsNav = [
  { name: 'Integrations', href: '/dashboard/integrations', icon: RefreshCw },
  { name: 'Event Log', href: '/dashboard/events', icon: List },
  { name: 'Failed Syncs', href: '/dashboard/failed', icon: AlertTriangle },
]

const configNav = [
  { name: 'Field Mappings', href: '/dashboard/mappings', icon: Map },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
]

function NavSection({
  label,
  items,
  pathname,
  isCollapsed,
  onNavigate,
  isFirst = false,
}: {
  label: string
  items: typeof mainNav
  pathname: string
  isCollapsed: boolean
  onNavigate?: () => void
  isFirst?: boolean
}) {
  return (
    <div className={cn(!isFirst && 'mt-2 border-t border-sidebar-border pt-3')}>
      {!isCollapsed && (
        <div className="mb-2 px-5 text-[0.75rem] font-normal uppercase tracking-[0.05rem] text-medship-secondary">
          {label}
        </div>
      )}
      <div className="space-y-0.5">
        {items.map((item) => {
          const isActive =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(item.href)

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                'group relative flex items-center text-[0.813rem] font-normal transition-colors',
                isCollapsed
                  ? 'mx-auto justify-center rounded-[0.625rem] p-[0.813rem]'
                  : 'rounded-md px-5 py-[0.625rem]',
                isActive
                  ? 'text-medship-secondary'
                  : 'text-sidebar-foreground hover:text-medship-secondary'
              )}
            >
              <item.icon
                className={cn(
                  'h-[1.375rem] w-[1.375rem] flex-shrink-0',
                  !isCollapsed && 'mr-[0.65rem]',
                  isActive
                    ? 'text-medship-secondary'
                    : 'text-sidebar-foreground/60 group-hover:text-medship-secondary'
                )}
              />
              {!isCollapsed && <span>{item.name}</span>}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { isCollapsed, toggleSidebar, isMobileOpen, closeMobile } = useSidebar()

  const sidebarContent = (
    <div
      className={cn(
        'flex h-full flex-col bg-sidebar transition-all duration-300',
        isCollapsed ? 'w-[3.75rem]' : 'w-[15rem]'
      )}
      style={{ boxShadow: '0 0.9375rem 1.875rem 0 rgba(0,0,0,0.02)' }}
    >
      {/* Logo — matches YashAdmin header area height of 4.375rem */}
      <div className={cn(
        'flex h-[4.375rem] items-center border-b border-sidebar-border',
        isCollapsed ? 'justify-center px-2' : 'px-5'
      )}>
        {isCollapsed ? (
          <span className="text-lg font-bold text-white">M</span>
        ) : (
          <div className="flex items-center gap-1">
            <Activity className="h-5 w-5 text-medship-secondary" />
            <span className="text-lg font-semibold text-white">YASH</span>
            <span className="text-lg font-normal text-white/70">ADMIN</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <NavSection
          label="Business"
          items={mainNav}
          pathname={pathname}
          isCollapsed={isCollapsed}
          isFirst
        />
        <NavSection
          label="Operations"
          items={opsNav}
          pathname={pathname}
          isCollapsed={isCollapsed}
        />
        <NavSection
          label="Configuration"
          items={configNav}
          pathname={pathname}
          isCollapsed={isCollapsed}
        />
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-sidebar-border px-2 py-2">
        <button
          onClick={toggleSidebar}
          className="flex w-full items-center justify-center rounded-[0.625rem] p-2 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
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
        <div className="border-t border-sidebar-border px-5 py-3">
          <div className="flex items-center gap-2 text-[0.75rem] text-sidebar-foreground/40">
            <Activity className="h-3.5 w-3.5" />
            <span>MedShip Prometheus v0.1</span>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <>
      {/* Desktop sidebar — visible at lg (1024px+) */}
      <aside className="hidden h-full flex-shrink-0 lg:flex">{sidebarContent}</aside>

      {/* Mobile/tablet overlay — visible below lg */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeMobile}
            aria-hidden="true"
          />
          <aside className="relative z-50 flex h-full w-[15rem]">
            <div className="flex h-full w-[15rem] flex-col bg-sidebar" style={{ boxShadow: '0 0.9375rem 1.875rem 0 rgba(0,0,0,0.02)' }}>
              {/* Mobile close + logo */}
              <div className="flex h-[4.375rem] items-center justify-between border-b border-sidebar-border px-5">
                <div className="flex items-center gap-1">
                  <Activity className="h-5 w-5 text-medship-secondary" />
                  <span className="text-lg font-semibold text-white">YASH</span>
                  <span className="text-lg font-normal text-white/70">ADMIN</span>
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
              <nav className="flex-1 overflow-y-auto py-4">
                <NavSection
                  label="Business"
                  items={mainNav}
                  pathname={pathname}
                  isCollapsed={false}
                  onNavigate={closeMobile}
                  isFirst
                />
                <NavSection
                  label="Operations"
                  items={opsNav}
                  pathname={pathname}
                  isCollapsed={false}
                  onNavigate={closeMobile}
                />
                <NavSection
                  label="Configuration"
                  items={configNav}
                  pathname={pathname}
                  isCollapsed={false}
                  onNavigate={closeMobile}
                />
              </nav>

              {/* Mobile footer */}
              <div className="border-t border-sidebar-border px-5 py-3">
                <div className="flex items-center gap-2 text-[0.75rem] text-sidebar-foreground/40">
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
