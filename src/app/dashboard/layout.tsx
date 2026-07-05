import { SidebarProvider } from '@/components/layout/SidebarContext'
import { Sidebar } from '@/components/layout/Sidebar'
import { requireDashboardAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const auth = await requireDashboardAuth()

  return (
    <SidebarProvider>
      <div className="flex h-screen">
        <Sidebar role={auth.role} />
        <main className="flex-1 overflow-auto bg-background">
          {children}
        </main>
      </div>
    </SidebarProvider>
  )
}
