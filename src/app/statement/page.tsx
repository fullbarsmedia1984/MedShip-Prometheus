import { MANAGER_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import { StatementClient } from './statement-client'

// Printable commission statement (Steven, 2026-07-04): manager/admin
// generates it manually and prints / saves as PDF — deliberately outside the
// dashboard layout so the print output has no chrome.
// TODO(#19): automate delivery to reps once the program is live.
export default async function StatementPage({
  searchParams,
}: {
  searchParams: Promise<{ rep?: string; month?: string }>
}) {
  await requireDashboardAuth(MANAGER_API_AUTH_OPTIONS)
  const { rep, month } = await searchParams
  return <StatementClient repKey={rep ?? null} month={month ?? null} />
}
