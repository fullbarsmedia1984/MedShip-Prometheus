import { STAFF_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import { getInventory, getInventoryKpis } from '@/lib/data'
import {
  INVENTORY_PAGE_SIZE,
  InventoryPageClient,
  type InventoryInitialData,
} from './InventoryPageClient'

// Auth reads cookies, so the page is always rendered per-request; the data
// itself comes from the tagged inventory cache (see src/lib/data.ts).
export const dynamic = 'force-dynamic'

/**
 * Server shell for the inventory list: fetches the client's default
 * filter/page state from the cached DAL so the table is populated on first
 * paint instead of after a client round-trip. Mirrors what
 * /api/dashboard/inventory returns for the same defaults (and its
 * staff-tier role gate).
 */
export default async function InventoryPage() {
  await requireDashboardAuth(STAFF_API_AUTH_OPTIONS)

  let initialData: InventoryInitialData | null = null
  try {
    const [result, kpis] = await Promise.all([
      getInventory({
        category: 'all',
        stockStatus: 'all',
        search: '',
        sort: 'sku:asc',
        page: 1,
        pageSize: INVENTORY_PAGE_SIZE,
      }),
      getInventoryKpis(),
    ])
    initialData = { result, kpis }
  } catch {
    // Fall back to the client's fetch-on-mount path rather than failing
    // the whole page render.
    initialData = null
  }

  return <InventoryPageClient initialData={initialData} />
}
