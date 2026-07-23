// =============================================================================
// AskZeus tool registry.
//
// Each tool wraps an existing data-access function so the bot answers from the
// exact same queries (and business rules) the dashboards use. Because the DAL
// runs on the service-role client, RLS does not apply here — the `roles` list
// on each tool re-implements the migration-026 tiers at the tool layer, and
// the route only registers tools the signed-in role is allowed to use, so the
// model never even sees the rest.
// =============================================================================

import 'server-only'

import type { AppRole } from '@/lib/auth'
import {
  getCategorySales,
  getEnhancedSalesReps,
  getInventory,
  getInventoryAlerts,
  getInventoryKpis,
  getMonthlyRevenue,
  getOrders,
  getPipelineSnapshot,
  getQuotes,
  getRevenueMetrics,
  getYoYRevenueComparison,
} from '@/lib/data'
import type { Order } from '@/lib/seed-data'
import { embedQuery } from '@/lib/hercules/embeddings'
import {
  getCatalogItemDetail,
  isSemanticSearchEnabled,
  searchCatalogItems,
} from '@/lib/hercules/catalog-browse'
import { getWallboardData, type WallboardOrder } from '@/lib/warehouse-board/data'
import { getReceivingData } from '@/lib/warehouse-board/receiving-data'
import { getKitKpis, getKitWorkbench, type KitRow } from '@/lib/kits/data'
import { createAdminClient } from '@/lib/supabase/admin'

export interface ToolContext {
  role: AppRole
  userId: string | null
  /**
   * Fishbowl salesperson aliases the user is row-scoped to. `null` means
   * unrestricted (staff+); an empty array means a rep with no alias linkage,
   * which correctly matches nothing (fail closed).
   */
  repAliases: string[] | null
}

export interface AskZeusTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  roles: AppRole[]
  /** Label for the in-flight activity chip, e.g. "Searching orders…" */
  activityLabel: string
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}

export interface ToolResult {
  /** JSON-serializable payload returned to the model. */
  data: unknown
  /** Short human summary for the UI chip, e.g. "12 orders found". */
  summary: string
}

const ADMIN: AppRole[] = ['superadmin', 'admin']
const STAFF_UP: AppRole[] = [...ADMIN, 'staff']
const REVENUE_TIER: AppRole[] = [...STAFF_UP, 'sales_manager']
const SALES_TIER: AppRole[] = [...REVENUE_TIER, 'sales_rep']
const WAREHOUSE_TIER: AppRole[] = [...STAFF_UP, 'warehouse']
const ALL_ROLES: AppRole[] = [...ADMIN, 'staff', 'sales_manager', 'sales_rep', 'warehouse']

const DEFAULT_LIMIT = 25

function str(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function limitOf(input: Record<string, unknown>, max = 50): number {
  const value = Number(input.limit)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT
  return Math.min(Math.round(value), max)
}

/** Rep scoping: undefined = unrestricted, [] = matches nothing (fail closed). */
function repScope(ctx: ToolContext): string[] | undefined {
  return ctx.repAliases ?? undefined
}

function compactOrder(order: Order) {
  return {
    soNumber: order.orderNumber,
    customer: order.customerName,
    salesperson: order.salesRepName,
    date: order.date,
    status: order.status,
    sourceStatus: order.sourceStatus ?? null,
    subtotal: order.subtotal,
    lineItemCount: order.lineItemCount ?? order.items.length,
  }
}

function compactWallboardOrder(order: WallboardOrder) {
  return {
    soNumber: order.soNumber,
    customer: order.customer,
    salesperson: order.salesperson,
    ageDays: order.ageDays,
    scheduled: order.scheduled,
    daysPastScheduled: order.daysPastScheduled,
    lines: order.lines,
    pctFulfilled: order.pct,
    severity: order.severity,
    stockState: order.stock?.state ?? null,
    stockEta: order.stock?.eta ?? null,
    kitShipBy: order.kitShipBy,
  }
}

// -----------------------------------------------------------------------------
// Tools
// -----------------------------------------------------------------------------

const searchOrders: AskZeusTool = {
  name: 'search_orders',
  description:
    'Search Fishbowl sales orders (the operational and revenue source of truth). ' +
    'Call this when the user asks about orders, a customer’s purchase history, ' +
    'order statuses, or recent sales. Supports free-text search over SO number and ' +
    'customer name, plus status and date filters. Dates are YYYY-MM-DD.',
  inputSchema: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Free text: SO number or customer name fragment' },
      status: { type: 'string', description: 'Order status filter, e.g. Issued, Fulfilled' },
      date_from: { type: 'string', description: 'Earliest order date (YYYY-MM-DD)' },
      date_to: { type: 'string', description: 'Latest order date (YYYY-MM-DD)' },
      limit: { type: 'number', description: 'Max rows to return (default 25, max 50)' },
    },
    additionalProperties: false,
  },
  roles: SALES_TIER,
  activityLabel: 'Searching orders…',
  execute: async (input, ctx) => {
    const result = await getOrders({
      search: str(input, 'search'),
      status: str(input, 'status'),
      dateFrom: str(input, 'date_from'),
      dateTo: str(input, 'date_to'),
      salespersonIn: repScope(ctx),
      page: 1,
      pageSize: limitOf(input),
      includeItems: false,
    })
    return {
      data: {
        rows: result.data.map(compactOrder),
        totalCount: result.total,
        truncated: result.total > result.data.length,
      },
      summary: `${result.total} order${result.total === 1 ? '' : 's'} found`,
    }
  },
}

const getOrderDetail: AskZeusTool = {
  name: 'get_order_detail',
  description:
    'Fetch one sales order with its full line items by SO number. Call this when ' +
    'the user asks about a specific order’s contents, quantities, or fulfillment.',
  inputSchema: {
    type: 'object',
    properties: {
      order_number: { type: 'string', description: 'The Fishbowl SO number' },
    },
    required: ['order_number'],
    additionalProperties: false,
  },
  roles: SALES_TIER,
  activityLabel: 'Loading order detail…',
  execute: async (input, ctx) => {
    const orderNumber = str(input, 'order_number')
    if (!orderNumber) throw new Error('order_number is required')
    // Scoping stays in the DAL: for reps the salespersonIn filter guarantees
    // they can only pull their own orders.
    const result = await getOrders({
      search: orderNumber,
      salespersonIn: repScope(ctx),
      page: 1,
      pageSize: 5,
      includeItems: true,
    })
    const order = result.data.find((o) => o.orderNumber === orderNumber) ?? result.data[0]
    if (!order) {
      return {
        data: { found: false, note: 'No matching order visible to this user.' },
        summary: 'Order not found',
      }
    }
    return {
      data: {
        ...compactOrder(order),
        trackingNumber: order.trackingNumber ?? null,
        fulfillmentStatus: order.fulfillmentStatus,
        items: order.items.slice(0, 50).map((item) => ({
          partNumber: item.sku,
          description: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
        })),
      },
      summary: `Order ${order.orderNumber} loaded`,
    }
  },
}

const getCustomerSummary: AskZeusTool = {
  name: 'get_customer_summary',
  description:
    'Summarize a customer’s order history: order count, total revenue, first/last ' +
    'order dates, and recent orders. Call this when the user asks about a customer ' +
    'or account. Note: there is no customer master table — customers are matched by ' +
    'name on sales orders, so similar names may be the same customer.',
  inputSchema: {
    type: 'object',
    properties: {
      customer_query: { type: 'string', description: 'Customer name or fragment' },
      limit: { type: 'number', description: 'Max distinct customers to summarize (default 5, max 10)' },
    },
    required: ['customer_query'],
    additionalProperties: false,
  },
  roles: SALES_TIER,
  activityLabel: 'Summarizing customer…',
  execute: async (input, ctx) => {
    const query = str(input, 'customer_query')
    if (!query) throw new Error('customer_query is required')
    const maxCustomers = Math.min(Math.max(Number(input.limit) || 5, 1), 10)
    const result = await getOrders({
      search: query,
      salespersonIn: repScope(ctx),
      page: 1,
      pageSize: 500,
      includeItems: false,
    })
    const byCustomer = new Map<string, Order[]>()
    for (const order of result.data) {
      const key = order.customerName
      const bucket = byCustomer.get(key)
      if (bucket) bucket.push(order)
      else byCustomer.set(key, [order])
    }
    const customers = [...byCustomer.entries()]
      .map(([name, orders]) => {
        const dates = orders.map((o) => o.date).sort()
        return {
          customer: name,
          orderCount: orders.length,
          totalRevenue: Math.round(orders.reduce((sum, o) => sum + o.subtotal, 0) * 100) / 100,
          firstOrderDate: dates[0] ?? null,
          lastOrderDate: dates[dates.length - 1] ?? null,
          recentOrders: orders
            .slice()
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .slice(0, 5)
            .map(compactOrder),
        }
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, maxCustomers)
    return {
      data: {
        customers,
        matchedOrderCount: result.total,
        note: 'Customers are name-matched on sales orders; similar names may be duplicates of one account.',
      },
      summary: `${customers.length} customer${customers.length === 1 ? '' : 's'} matched`,
    }
  },
}

const getRevenueSummary: AskZeusTool = {
  name: 'get_revenue_summary',
  description:
    'Company revenue metrics from issued Fishbowl sales orders (the ONLY revenue ' +
    'source of truth). Call this for questions about revenue, sales totals, growth, ' +
    'or month-over-month / year-over-year comparisons. view="current" gives MTD KPIs, ' +
    '"monthly" the trailing 12 months, "yoy" the calendar year vs prior year.',
  inputSchema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['current', 'monthly', 'yoy'],
        description: 'Which summary to return (default "current")',
      },
    },
    additionalProperties: false,
  },
  roles: REVENUE_TIER,
  activityLabel: 'Crunching revenue…',
  execute: async (input) => {
    const view = str(input, 'view') ?? 'current'
    if (view === 'monthly') {
      const months = await getMonthlyRevenue()
      return { data: { months }, summary: `${months.length} months of revenue` }
    }
    if (view === 'yoy') {
      const yoy = await getYoYRevenueComparison()
      return {
        data: yoy,
        summary: `YoY ${yoy.currentYearLabel} vs ${yoy.priorYearLabel}`,
      }
    }
    const metrics = await getRevenueMetrics()
    return { data: metrics, summary: 'Current revenue KPIs loaded' }
  },
}

const getCategorySalesTool: AskZeusTool = {
  name: 'get_category_sales',
  description:
    'Revenue split by product family/category (from won Salesforce opportunity line ' +
    'items). Call this when the user asks which product categories sell most.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  roles: REVENUE_TIER,
  activityLabel: 'Breaking down categories…',
  execute: async () => {
    const categories = await getCategorySales()
    return { data: { categories }, summary: `${categories.length} categories` }
  },
}

const getSalesLeaderboard: AskZeusTool = {
  name: 'get_sales_leaderboard',
  description:
    'Per-rep sales performance: MTD/QTD/YTD revenue, deals closed, quotes sent, win ' +
    'rate, and pipeline value. Call this for questions about rep performance or ' +
    'leaderboards.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  roles: REVENUE_TIER,
  activityLabel: 'Ranking the reps…',
  execute: async () => {
    const reps = await getEnhancedSalesReps()
    return {
      data: {
        reps: reps.map((rep) => ({
          name: rep.name,
          region: rep.region,
          revenueMTD: rep.revenueMTD,
          revenueQTD: rep.revenueQTD,
          revenueYTD: rep.revenueYTD,
          dealsClosed: rep.dealsClosed,
          quotesSent: rep.quotesSent,
          winRate: rep.winRate,
          pipelineValue: rep.pipelineValue,
          activityScore: rep.activityScore,
        })),
      },
      summary: `${reps.length} reps ranked`,
    }
  },
}

const getPipelineAndQuotes: AskZeusTool = {
  name: 'get_pipeline_and_quotes',
  description:
    'Salesforce pipeline by stage plus recent quotes. Pipeline is FUTURE business — ' +
    'never report it as revenue. Call this for questions about open opportunities, ' +
    'pipeline value, or quote activity/status.',
  inputSchema: {
    type: 'object',
    properties: {
      quote_search: { type: 'string', description: 'Free text over quote customer/rep' },
      quote_status: {
        type: 'string',
        description: 'Quote status filter: sent, viewed, accepted, expired, rejected',
      },
      limit: { type: 'number', description: 'Max quotes to return (default 25, max 50)' },
    },
    additionalProperties: false,
  },
  roles: SALES_TIER,
  activityLabel: 'Checking pipeline and quotes…',
  execute: async (input, ctx) => {
    const [pipeline, quotes] = await Promise.all([
      getPipelineSnapshot(),
      getQuotes({
        search: str(input, 'quote_search'),
        status: str(input, 'quote_status'),
        salespersonIn: repScope(ctx),
        page: 1,
        pageSize: limitOf(input),
      }),
    ])
    return {
      data: {
        pipeline: pipeline.map(({ stage, count, value }) => ({ stage, count, value })),
        quotes: {
          rows: quotes.data.map((quote) => ({
            id: quote.id,
            date: quote.date,
            rep: quote.repName,
            customer: quote.customerName,
            amount: quote.amount,
            status: quote.status,
            daysOpen: quote.daysOpen,
          })),
          totalCount: quotes.total,
          truncated: quotes.total > quotes.data.length,
        },
      },
      summary: `${quotes.total} quote${quotes.total === 1 ? '' : 's'}, ${pipeline.length} pipeline stages`,
    }
  },
}

const searchInventory: AskZeusTool = {
  name: 'search_inventory',
  description:
    'Search the cached Fishbowl inventory snapshot by part number or description. ' +
    'Call this for stock questions: quantity on hand, available, allocated, or low/out ' +
    'of stock items. Set alerts_only=true to list items at or below reorder point.',
  inputSchema: {
    type: 'object',
    properties: {
      search: { type: 'string', description: 'Part number or description fragment' },
      stock_status: {
        type: 'string',
        enum: ['all', 'in_stock', 'low', 'out_of_stock'],
        description: 'Stock status filter',
      },
      alerts_only: { type: 'boolean', description: 'Only items at/below reorder point' },
      limit: { type: 'number', description: 'Max rows (default 25, max 50)' },
    },
    additionalProperties: false,
  },
  roles: WAREHOUSE_TIER,
  activityLabel: 'Checking stock…',
  execute: async (input, ctx) => {
    const isAdmin = ADMIN.includes(ctx.role)
    if (input.alerts_only === true) {
      const alerts = await getInventoryAlerts(limitOf(input))
      return {
        data: {
          rows: alerts.map((p) => ({
            sku: p.sku,
            name: p.name,
            qtyOnHand: p.qtyOnHand,
            qtyAvailable: p.qtyAvailable,
            reorderPoint: p.reorderPoint,
            ...(isAdmin ? { cost: p.cost } : {}),
          })),
        },
        summary: `${alerts.length} low-stock item${alerts.length === 1 ? '' : 's'}`,
      }
    }
    const stockStatus = str(input, 'stock_status') as
      | 'all'
      | 'in_stock'
      | 'low'
      | 'out_of_stock'
      | undefined
    const result = await getInventory({
      search: str(input, 'search'),
      stockStatus,
      page: 1,
      pageSize: limitOf(input),
    })
    return {
      data: {
        rows: result.data.map((p) => ({
          sku: p.sku,
          name: p.name,
          qtyOnHand: p.qtyOnHand,
          qtyAllocated: p.qtyAllocated,
          qtyAvailable: p.qtyAvailable,
          reorderPoint: p.reorderPoint,
          ...(isAdmin ? { cost: p.cost } : {}),
        })),
        totalCount: result.total,
        truncated: result.total > result.data.length,
      },
      summary: `${result.total} item${result.total === 1 ? '' : 's'} found`,
    }
  },
}

const getInventoryKpisTool: AskZeusTool = {
  name: 'get_inventory_kpis',
  description:
    'Inventory health at a glance: total SKUs, in stock, low stock, out of stock. ' +
    'Call this for overall inventory-health questions.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  roles: WAREHOUSE_TIER,
  activityLabel: 'Summarizing inventory…',
  execute: async () => {
    const kpis = await getInventoryKpis()
    return { data: kpis, summary: `${kpis.totalSkus} SKUs tracked` }
  },
}

const getWarehouseStatus: AskZeusTool = {
  name: 'get_warehouse_status',
  description:
    'Live warehouse fulfillment board: orders ready to pick, in picking, shipped, ' +
    'late, or blocked on purchasing, with stock posture per order. Call this for ' +
    'questions about the warehouse floor, what needs picking, late orders, or ' +
    'fulfillment backlog.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  roles: WAREHOUSE_TIER,
  activityLabel: 'Reading the warehouse board…',
  execute: async () => {
    const board = await getWallboardData()
    const cap = (orders: WallboardOrder[]) => orders.slice(0, 20).map(compactWallboardOrder)
    return {
      data: {
        generatedAt: board.generatedAt,
        kpis: board.kpis,
        syncAgesMinutes: board.syncAges,
        readyToPick: cap(board.ready),
        pickingSales: cap(board.pickingSales),
        pickingKits: cap(board.pickingKits),
        shippedRecently: cap(board.shipped),
        longestWaiting: cap(board.longestWaiting),
        alerts: board.alerts,
        note: 'Lanes are capped at 20 orders each; KPI counts are complete.',
      },
      summary: `${board.kpis.readyCount} ready, ${board.kpis.pickingCount} picking, ${board.kpis.lateCount} late`,
    }
  },
}

const getReceivingStatus: AskZeusTool = {
  name: 'get_receiving_status',
  description:
    'Today’s inbound receiving activity: purchase orders received, lines and ' +
    'quantities checked in, and cross-dock candidates (received parts needed by open ' +
    'sales orders). Call this for questions about receiving, inbound POs, or deliveries.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  roles: WAREHOUSE_TIER,
  activityLabel: 'Checking receiving…',
  execute: async () => {
    const receiving = await getReceivingData()
    return {
      data: {
        chicagoDate: receiving.chicagoDate,
        source: receiving.sourceLabel,
        totals: receiving.totals,
        orders: receiving.orders.slice(0, 25).map((order) => ({
          poNumber: order.poNumber,
          vendor: order.vendorName,
          linesReceivedToday: order.linesReceivedToday,
          totalPoLines: order.totalPoLines,
          quantityReceivedToday: order.quantityReceivedToday,
          lastReceivedAt: order.lastReceivedAt,
          crossDockOrderCount: order.crossDockOrderCount,
        })),
      },
      summary: `${receiving.totals.purchaseOrders} PO${receiving.totals.purchaseOrders === 1 ? '' : 's'} received today`,
    }
  },
}

const searchCatalog: AskZeusTool = {
  name: 'search_catalog',
  description:
    'Search the Hercules supplier catalog (hybrid keyword + semantic search) for ' +
    'purchasable products: descriptions, manufacturers, vendors, and supplier ' +
    'pricing. Call this when the user asks about sourcing a product, supplier ' +
    'options, or catalog pricing. Pass item_id (from a prior search) to get full ' +
    'vendor offers and unit-of-measure pricing for one item.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for (natural language is fine)' },
      manufacturer: { type: 'string', description: 'Manufacturer name filter' },
      category: { type: 'string', description: 'Category filter' },
      vendor: { type: 'string', description: 'Vendor filter' },
      item_id: { type: 'string', description: 'Catalog item id for full detail' },
      limit: { type: 'number', description: 'Max items (default 10, max 20)' },
    },
    additionalProperties: false,
  },
  roles: ALL_ROLES,
  activityLabel: 'Searching supplier catalog…',
  execute: async (input) => {
    const itemId = str(input, 'item_id')
    if (itemId) {
      const detail = await getCatalogItemDetail(itemId)
      if (!detail) {
        return { data: { found: false }, summary: 'Catalog item not found' }
      }
      return {
        data: {
          id: detail.id,
          description: detail.description,
          brand: detail.brand,
          manufacturer: detail.manufacturerName,
          manufacturerPartNumber: detail.manufacturerPartNumber,
          category: detail.category,
          offers: detail.offers.slice(0, 10).map((offer) => ({
            vendor: offer.vendorName,
            supplier: offer.supplierName,
            leadTime: offer.leadTime,
            minimumOrderQuantity: offer.minimumOrderQuantity,
            uoms: offer.uoms.slice(0, 10).map((uom) => ({
              uom: uom.uomCode,
              vendorPartNumber: uom.vendorPartNumber,
              package: uom.package,
              listPrice: uom.listPriceAmount,
              contractPrice: uom.contractPriceAmount,
              quantityAvailable: uom.quantityAvailable,
            })),
          })),
        },
        summary: `Detail for ${detail.manufacturerPartNumber ?? detail.description ?? itemId}`,
      }
    }

    const query = str(input, 'query')
    if (!query) throw new Error('Provide either query or item_id')
    const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 20)
    const queryEmbedding = (await isSemanticSearchEnabled()) ? await embedQuery(query) : null
    const result = await searchCatalogItems(
      {
        q: query,
        manufacturer: str(input, 'manufacturer'),
        category: str(input, 'category'),
        vendor: str(input, 'vendor'),
        sort: 'relevance',
        page: 1,
        pageSize: limit,
      },
      queryEmbedding
    )
    return {
      data: {
        items: result.items.map((item) => ({
          id: item.id,
          description: item.description,
          brand: item.brand,
          manufacturer: item.manufacturerName,
          manufacturerPartNumber: item.manufacturerPartNumber,
          category: item.category,
          vendors: item.vendors,
          offerCount: item.offerCount,
          priceMin: item.priceMin,
          priceMax: item.priceMax,
        })),
        hasMore: result.hasMore,
      },
      summary: `${result.items.length} catalog item${result.items.length === 1 ? '' : 's'}`,
    }
  },
}

function compactKitRow(row: KitRow) {
  return {
    soNumber: row.soNumber,
    school: row.school,
    status: row.status,
    urgency: row.urgency,
    kits: row.kits,
    units: row.units,
    unitsDone: row.unitsDone,
    pctDone: row.pct,
    poReceived: row.poReceived,
    earliestShipBy: row.earliestShipBy,
    latestShipBy: row.latestShipBy,
    shippedAt: row.shippedAt,
    turnTimeDays: row.turnTimeDays,
    onTime: row.onTime,
    rep: row.ops.rep,
    tableLocation: row.ops.table_location,
    notes: row.ops.notes,
    backorderCount: row.backorders.length,
    backordersNoPo: row.backordersNoPo,
    backorders: row.backorders.slice(0, 5),
  }
}

const getKitOrders: AskZeusTool = {
  name: 'get_kit_orders',
  description:
    'Nursing-kit assembly workbench: every open kit order with school, need-by and ' +
    'ship-by dates, assembly progress, staging table, backorders, and urgency ' +
    '(overdue / due today / this week). view="performance" adds shipped-kit KPIs ' +
    '(on-time %, median turn time, by rep and school). Call this for ANY question ' +
    'about kit orders, kit assembly, kit deadlines, or kit performance.',
  inputSchema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['workbench', 'performance'],
        description: 'workbench = open kit orders (default); performance = shipped KPIs',
      },
      urgency: {
        type: 'string',
        enum: ['overdue', 'due_today', 'this_week', 'on_track', 'no_dates', 'shipped'],
        description: 'Filter workbench rows by urgency',
      },
      search: { type: 'string', description: 'SO number or school name fragment' },
      limit: { type: 'number', description: 'Max rows (default 25, max 50)' },
    },
    additionalProperties: false,
  },
  roles: WAREHOUSE_TIER,
  activityLabel: 'Checking kit orders…',
  execute: async (input) => {
    if (str(input, 'view') === 'performance') {
      const kpis = await getKitKpis()
      return {
        data: {
          windowDays: kpis.windowDays,
          shipped: kpis.shipped,
          onTimePct: kpis.onTimePct,
          medianTurnDays: kpis.medianTurnDays,
          byRep: kpis.byRep.slice(0, 15),
          bySchool: kpis.bySchool.slice(0, 15),
        },
        summary: `${kpis.shipped} kits shipped in ${kpis.windowDays}d`,
      }
    }
    const workbench = await getKitWorkbench()
    const urgency = str(input, 'urgency')
    const search = str(input, 'search')?.toLowerCase()
    let rows = workbench.rows
    if (urgency) rows = rows.filter((row) => row.urgency === urgency)
    if (search) {
      rows = rows.filter(
        (row) =>
          row.soNumber.toLowerCase().includes(search) ||
          row.school.toLowerCase().includes(search)
      )
    }
    const limit = limitOf(input)
    return {
      data: {
        totals: workbench.totals,
        rows: rows.slice(0, limit).map(compactKitRow),
        totalCount: rows.length,
        truncated: rows.length > limit,
      },
      summary: `${rows.length} kit order${rows.length === 1 ? '' : 's'}`,
    }
  },
}

const getRecentShipments: AskZeusTool = {
  name: 'get_recent_shipments',
  description:
    'Shipments that left the warehouse in the last ~10 days (Fishbowl ship records: ' +
    'ship number, sales order, ship date, carton count). Call this for questions ' +
    'about what shipped recently or whether a specific order has shipped.',
  inputSchema: {
    type: 'object',
    properties: {
      so_number: { type: 'string', description: 'Filter to one sales order number' },
      limit: { type: 'number', description: 'Max rows (default 25, max 50)' },
    },
    additionalProperties: false,
  },
  roles: WAREHOUSE_TIER,
  activityLabel: 'Checking recent shipments…',
  execute: async (input) => {
    const supabase = createAdminClient()
    let query = supabase
      .from('fb_recent_shipments')
      .select('ship_number, so_number, date_shipped, carton_count')
      .order('date_shipped', { ascending: false })
      .limit(limitOf(input))
    const soNumber = str(input, 'so_number')
    if (soNumber) query = query.eq('so_number', soNumber)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as Array<{
      ship_number: string
      so_number: string
      date_shipped: string
      carton_count: number | null
    }>
    return {
      data: {
        rows: rows.map((row) => ({
          shipNumber: row.ship_number,
          soNumber: row.so_number,
          dateShipped: row.date_shipped,
          cartonCount: row.carton_count,
        })),
        note: 'Rolling ~10-day cache of outbound shipments.',
      },
      summary: `${rows.length} shipment${rows.length === 1 ? '' : 's'}`,
    }
  },
}

const REGISTRY: AskZeusTool[] = [
  searchOrders,
  getOrderDetail,
  getCustomerSummary,
  getRevenueSummary,
  getCategorySalesTool,
  getSalesLeaderboard,
  getPipelineAndQuotes,
  searchInventory,
  getInventoryKpisTool,
  getWarehouseStatus,
  getReceivingStatus,
  getKitOrders,
  getRecentShipments,
  searchCatalog,
]

/** Tools visible to a given role — the agent never sees the rest. */
export function toolsForRole(role: AppRole): AskZeusTool[] {
  return REGISTRY.filter((tool) => tool.roles.includes(role))
}
