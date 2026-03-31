'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  ListOrdered,
  AlertTriangle,
  Settings,
  Workflow,
} from 'lucide-react'

const navigation = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    name: 'Events',
    href: '/dashboard/events',
    icon: ListOrdered,
  },
  {
    name: 'Failed Syncs',
    href: '/dashboard/failed',
    icon: AlertTriangle,
  },
  {
    name: 'Mappings',
    href: '/dashboard/mappings',
    icon: Workflow,
  },
  {
    name: 'Settings',
    href: '/dashboard/settings',
    icon: Settings,
  },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="flex h-full w-64 flex-col bg-gray-900">
      {/* Logo */}
      <div className="flex h-16 items-center px-6">
        <span className="text-xl font-bold text-white">MedShip</span>
        <span className="ml-2 text-xl font-light text-gray-400">Prometheus</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'group flex items-center rounded-md px-3 py-2 text-sm font-medium',
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              )}
            >
              <item.icon
                className={cn(
                  'mr-3 h-5 w-5 flex-shrink-0',
                  isActive ? 'text-white' : 'text-gray-400 group-hover:text-white'
                )}
              />
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="flex flex-shrink-0 border-t border-gray-800 p-4">
        <div className="text-xs text-gray-500">
          <p>Integration Hub v0.1.0</p>
          <p className="mt-1">SF + Fishbowl + QB</p>
        </div>
      </div>
    </div>
  )
}
