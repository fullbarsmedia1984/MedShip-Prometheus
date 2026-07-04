'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { AppRole } from '@/lib/auth'
import { useSidebar } from './SidebarContext'
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  BarChart3,
  Boxes,
  DollarSign,
  FileText,
  GraduationCap,
  MapPin,
  RefreshCw,
  Trophy,
  List,
  AlertTriangle,
  Map,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react'

const ADMIN_ROLES: AppRole[] = ['superadmin', 'admin']
const STAFF_ROLES: AppRole[] = ['superadmin', 'admin', 'staff']
const MANAGER_ROLES: AppRole[] = ['superadmin', 'admin', 'staff', 'sales_manager']
const REP_ROLES: AppRole[] = ['sales_rep']

type NavItem = {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  roles?: AppRole[]
}

// Items without `roles` are visible to every signed-in role (sales reps get
// the sales experience: Sales, Quotes, Orders).
const mainNav: NavItem[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: STAFF_ROLES },
  { name: 'Sales', href: '/dashboard/sales', icon: BarChart3 },
  { name: 'Incentives', href: '/dashboard/incentives', icon: Trophy, roles: MANAGER_ROLES },
  { name: 'My Scorecard', href: '/dashboard/incentives/scorecard', icon: Trophy, roles: REP_ROLES },
  { name: 'TAM', href: '/dashboard/tam', icon: GraduationCap, roles: STAFF_ROLES },
  { name: 'Quotes', href: '/dashboard/quotes', icon: FileText },
  { name: 'Pricing', href: '/dashboard/pricing', icon: DollarSign, roles: STAFF_ROLES },
  { name: 'Estimator', href: '/dashboard/estimator', icon: Boxes, roles: STAFF_ROLES },
  { name: 'Orders', href: '/dashboard/orders', icon: ShoppingCart },
  { name: 'Inventory', href: '/dashboard/inventory', icon: Package, roles: STAFF_ROLES },
  { name: 'Territory', href: '/dashboard/territory', icon: MapPin, roles: STAFF_ROLES },
]

const opsNav: NavItem[] = [
  { name: 'Integrations', href: '/dashboard/integrations', icon: RefreshCw, roles: STAFF_ROLES },
  { name: 'Event Log', href: '/dashboard/events', icon: List, roles: STAFF_ROLES },
  { name: 'Failed Syncs', href: '/dashboard/failed', icon: AlertTriangle, roles: STAFF_ROLES },
]

const configNav: NavItem[] = [
  { name: 'Field Mappings', href: '/dashboard/mappings', icon: Map, roles: STAFF_ROLES },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings, roles: ADMIN_ROLES },
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

export function Sidebar({ role }: { role: AppRole | null }) {
  const pathname = usePathname()
  const { isCollapsed, toggleSidebar, isMobileOpen, closeMobile } = useSidebar()

  const canSee = (item: NavItem) =>
    !item.roles || (role !== null && item.roles.includes(role))
  const mainItems = mainNav.filter(canSee)
  const opsItems = opsNav.filter(canSee)
  const configItems = configNav.filter(canSee)

  const sidebarContent = (
    <div
      className={cn(
        'flex h-full flex-col bg-sidebar transition-all duration-300',
        isCollapsed ? 'w-[3.75rem]' : 'w-[15rem]'
      )}
      style={{ boxShadow: '0 0.9375rem 1.875rem 0 rgba(0,0,0,0.02)' }}
    >
      {/* Logo */}
      <div className={cn(
        'flex h-[4.375rem] items-center border-b border-sidebar-border',
        isCollapsed ? 'justify-center px-2' : 'px-5'
      )}>
        {isCollapsed ? (
          <img src="/ms-icon-color.png" alt="Medical Shipment" className="h-6 w-6" />
        ) : (
          <div className="flex items-center gap-2">
            <img src="/ms-icon-color.png" alt="Medical Shipment" className="h-8 w-8" />
            <span className="text-lg font-semibold text-white">MEDICAL</span>
            <span className="text-lg font-normal text-white/70">SHIPMENT</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        <NavSection
          label="Business"
          items={mainItems}
          pathname={pathname}
          isCollapsed={isCollapsed}
          isFirst
        />
        {opsItems.length > 0 && (
          <NavSection
            label="Operations"
            items={opsItems}
            pathname={pathname}
            isCollapsed={isCollapsed}
          />
        )}
        {configItems.length > 0 && (
          <NavSection
            label="Configuration"
            items={configItems}
            pathname={pathname}
            isCollapsed={isCollapsed}
          />
        )}
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
            <img src="/ms-icon-color.png" alt="MedShip" className="h-3.5 w-3.5 opacity-40" />
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
                <div className="flex items-center gap-2">
                  <img src="/ms-icon-color.png" alt="Medical Shipment" className="h-8 w-8" />
                  <span className="text-lg font-semibold text-white">MEDICAL</span>
                  <span className="text-lg font-normal text-white/70">SHIPMENT</span>
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
                  items={mainItems}
                  pathname={pathname}
                  isCollapsed={false}
                  onNavigate={closeMobile}
                  isFirst
                />
                {opsItems.length > 0 && (
                  <NavSection
                    label="Operations"
                    items={opsItems}
                    pathname={pathname}
                    isCollapsed={false}
                    onNavigate={closeMobile}
                  />
                )}
                {configItems.length > 0 && (
                  <NavSection
                    label="Configuration"
                    items={configItems}
                    pathname={pathname}
                    isCollapsed={false}
                    onNavigate={closeMobile}
                  />
                )}
              </nav>

              {/* Mobile footer */}
              <div className="border-t border-sidebar-border px-5 py-3">
                <div className="flex items-center gap-2 text-[0.75rem] text-sidebar-foreground/40">
                  <img src="/ms-icon-color.png" alt="MedShip" className="h-3.5 w-3.5 opacity-40" />
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
