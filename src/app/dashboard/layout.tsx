import { SidebarProvider } from '@/components/layout/SidebarContext'
import { Sidebar } from '@/components/layout/Sidebar'
import { AuthInfoProvider } from '@/components/layout/AuthInfoContext'
import { ChangelogDialog } from '@/components/help/ChangelogDialog'
import { requireDashboardAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const auth = await requireDashboardAuth()

  return (
    <AuthInfoProvider
      value={{ email: auth.user?.email ?? null, role: auth.role }}
    >
      <SidebarProvider>
        <div className="flex h-screen">
          <Sidebar role={auth.role} />
          <main className="min-w-0 flex-1 overflow-auto bg-background">
            {children}
          </main>
        </div>
        <ChangelogDialog />
      </SidebarProvider>
    </AuthInfoProvider>
  )
}
