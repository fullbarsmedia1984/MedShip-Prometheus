import { redirect } from 'next/navigation'
import { requireDashboardAuth } from '@/lib/auth'
import OverviewPageClient from './OverviewPageClient'

export const dynamic = 'force-dynamic'

export default async function DashboardOverviewPage() {
  const auth = await requireDashboardAuth()

  // The overview is the CEO/ops hub; sales roles land on their own dashboard.
  if (auth.role === 'sales_rep' || auth.role === 'sales_manager') {
    redirect('/dashboard/sales')
  }

  return <OverviewPageClient />
}
