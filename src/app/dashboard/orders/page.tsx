import { SALES_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import {
  ORDERS_DEFAULT_PAGE_SIZE,
  buildOrderFilters,
  getOrdersDashboardPayload,
  type OrdersDashboardPayload,
} from '@/lib/orders-payload'
import { resolveRepScope } from '@/lib/sales-scope'
import { OrdersPageClient } from './OrdersPageClient'

// Server-rendered first paint: fetch the payload for the DEFAULT filter state
// (the exact state the client component mounts with) using the same shared
// filter/scoping helpers as /api/dashboard/orders, so page and route cannot
// drift. All subsequent filter interactions use the client fetch path.
export default async function OrdersPage() {
  const auth = await requireDashboardAuth(SALES_API_AUTH_OPTIONS)

  let initialData: OrdersDashboardPayload | undefined
  try {
    const repScope = await resolveRepScope(auth.role, auth.user)
    initialData = await getOrdersDashboardPayload(
      buildOrderFilters({}, repScope),
      1,
      ORDERS_DEFAULT_PAGE_SIZE
    )
  } catch {
    // If the server-side fetch fails, fall back to the client's original
    // fetch-on-mount behavior instead of crashing the page.
  }

  return <OrdersPageClient initialData={initialData} />
}
