import { SALES_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import { getScopedOrderById } from '@/lib/orders-payload'
import { resolveRepScope } from '@/lib/sales-scope'
import type { Order } from '@/lib/seed-data'
import { OrderDetailClient } from './OrderDetailClient'

type OrderDetailPageProps = {
  params: Promise<{ id: string }>
}

// Server-rendered first paint: resolve the order with the same shared
// scoping helper the detail API route uses (getScopedOrderById +
// resolveRepScope), so a sales rep cannot see another rep's order by direct
// navigation — out-of-scope rows render as "not found", never 403.
export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { id } = await params
  const auth = await requireDashboardAuth(SALES_API_AUTH_OPTIONS)

  let initialOrder: Order | null | undefined
  try {
    const repScope = await resolveRepScope(auth.role, auth.user)
    initialOrder = await getScopedOrderById(id, repScope)
  } catch {
    // If the server-side fetch fails, fall back to the client's original
    // fetch-on-mount behavior instead of crashing the page.
    initialOrder = undefined
  }

  return <OrderDetailClient orderId={id} initialOrder={initialOrder} />
}
