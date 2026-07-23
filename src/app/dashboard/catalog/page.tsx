import { CATALOG_API_AUTH_OPTIONS, requireDashboardAuth } from '@/lib/auth'
import {
  getCatalogFacets,
  searchCatalogItems,
  stripSearchPrices,
} from '@/lib/hercules/catalog-browse'
import {
  CATALOG_PAGE_SIZE,
  CatalogPageClient,
  type CatalogInitialData,
} from './CatalogPageClient'

// Mirrors PRICE_ROLES in /api/hercules/catalog — owner decision 2026-07-08:
// every signed-in role (sales reps, purchasing/quotes staff, admins) may see
// supplier cost.
const PRICE_ROLES = new Set(['superadmin', 'admin', 'staff', 'sales_manager', 'sales_rep', 'warehouse'])

// Auth reads cookies, so the page is always rendered per-request; the search
// and facets come from the unstable_cache'd catalog DAL (tag 'catalog-cache').
export const dynamic = 'force-dynamic'

/**
 * Server shell for the supplier catalog: runs the default browse query
 * (no search, no filters, page 1) plus facets through the cached DAL so the
 * result list is populated on first paint. Search/filter/pagination all stay
 * client-side against /api/hercules/catalog.
 */
export default async function SupplierCatalogPage() {
  const auth = await requireDashboardAuth(CATALOG_API_AUTH_OPTIONS)
  const canSeePrices = auth.role !== null && PRICE_ROLES.has(auth.role)

  let initialData: CatalogInitialData | null = null
  try {
    // Facets are additive UI sugar — never let a slow aggregate take the
    // whole page down (mirrors the API route's behavior).
    const [searchResult, facets] = await Promise.all([
      searchCatalogItems({ page: 1, pageSize: CATALOG_PAGE_SIZE }),
      getCatalogFacets().catch(() => null),
    ])
    initialData = {
      result: canSeePrices ? searchResult : stripSearchPrices(searchResult),
      facets,
      canSeePrices,
    }
  } catch {
    // Fall back to the client's fetch-on-mount path rather than failing
    // the whole page render.
    initialData = null
  }

  return <CatalogPageClient initialData={initialData} />
}
