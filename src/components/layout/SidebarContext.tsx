'use client'

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'

interface SidebarState {
  isCollapsed: boolean
  toggleSidebar: () => void
  isMobileOpen: boolean
  toggleMobile: () => void
  closeMobile: () => void
}

const SidebarContext = createContext<SidebarState | undefined>(undefined)

const STORAGE_KEY = 'medship-sidebar-collapsed'

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // Hydrate from localStorage after mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'true') {
      setIsCollapsed(true)
    }
    setHydrated(true)
  }, [])

  const toggleSidebar = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  const toggleMobile = useCallback(() => {
    setIsMobileOpen((prev) => !prev)
  }, [])

  const closeMobile = useCallback(() => {
    setIsMobileOpen(false)
  }, [])

  // Prevent flash of wrong state before hydration
  if (!hydrated) {
    return null
  }

  return (
    <SidebarContext.Provider
      value={{ isCollapsed, toggleSidebar, isMobileOpen, toggleMobile, closeMobile }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar(): SidebarState {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return context
}
