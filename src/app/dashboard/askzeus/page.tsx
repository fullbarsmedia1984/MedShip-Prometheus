import { Header } from '@/components/layout/Header'
import { ChatShell } from '@/components/askzeus/ChatShell'
import { ASKZEUS_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'AskZeus — MedShip Prometheus' }

export default async function AskZeusPage() {
  const auth = await requireDashboardAuth(ASKZEUS_API_AUTH_OPTIONS)

  return (
    <div className="flex h-full flex-col">
      <Header title="AskZeus" />
      <ChatShell role={auth.role ?? 'staff'} />
    </div>
  )
}
