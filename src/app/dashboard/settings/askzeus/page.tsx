import { Header } from '@/components/layout/Header'
import { KnowledgeManager } from '@/components/askzeus/KnowledgeManager'
import { ADMIN_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'AskZeus Knowledge — MedShip Prometheus' }

export default async function AskZeusKnowledgePage() {
  await requireDashboardAuth(ADMIN_API_AUTH_OPTIONS)

  return (
    <div className="flex h-full flex-col">
      <Header title="AskZeus Knowledge" />
      <main className="flex-1 overflow-y-auto p-6">
        <KnowledgeManager />
      </main>
    </div>
  )
}
