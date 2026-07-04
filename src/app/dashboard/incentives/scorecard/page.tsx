import { SALES_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import { getRepKeyForUser } from '@/lib/incentive/queries'
import { Card, CardContent } from '@/components/ui/card'
import { Header } from '@/components/layout/Header'
import { ScorecardView } from './scorecard-view'

// Staff and managers pick any rep; a sales_rep login is locked to their own
// scorecard via profiles.sf_user_id (the API enforces the same rule).
export default async function ScorecardPage() {
  const auth = await requireDashboardAuth(SALES_API_AUTH_OPTIONS)

  let lockedRepKey: string | null = null
  if (auth.role === 'sales_rep') {
    lockedRepKey = auth.user ? await getRepKeyForUser(auth.user.id) : null
    if (!lockedRepKey) {
      return (
        <div className="flex flex-col">
          <Header title="Q3 Incentive" />
          <main className="flex-1 p-6">
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Your login isn&apos;t linked to a sales rep yet. Ask an admin to set your
                Salesforce user on your profile (Settings → Users), then reload.
              </CardContent>
            </Card>
          </main>
        </div>
      )
    }
  }

  return <ScorecardView lockedRepKey={lockedRepKey} />
}
