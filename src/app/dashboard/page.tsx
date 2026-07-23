import { redirect } from 'next/navigation'
import { requireDashboardAuth } from '@/lib/auth'
import { getOverviewPayload, type OverviewPayload } from '@/lib/overview-payload'
import OverviewPageClient from './OverviewPageClient'

export const dynamic = 'force-dynamic'

export default async function DashboardOverviewPage() {
  const auth = await requireDashboardAuth()

  // The overview is the CEO/ops hub; sales roles land on their own dashboard
  // and warehouse/logistics lands on the kanban board.
  if (auth.role === 'sales_rep' || auth.role === 'sales_manager') {
    redirect('/dashboard/sales')
  }
  if (auth.role === 'warehouse') {
    redirect('/dashboard/kanban')
  }

  // Server-rendered first paint: the payload is cached (revalidate 300 + tag
  // busts from the sync crons), so this is warm on most navigations. If it
  // fails, fall back to the client's fetch-on-mount path instead of crashing.
  let initialData: OverviewPayload | null = null
  try {
    initialData = await getOverviewPayload()
  } catch (error) {
    console.error('[dashboard-overview] server payload load failed', error)
  }

  return <OverviewPageClient initialData={initialData} />
}
