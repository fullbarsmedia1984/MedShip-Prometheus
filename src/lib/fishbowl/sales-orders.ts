// =============================================================================
// Fishbowl Sales Order Operations
// =============================================================================

import type { FishbowlClient } from './client';
import type { FBSalesOrderPayload, FBSalesOrderResult } from '@/types';
import type { FBPaginatedResponse } from './types';
import {
  FishbowlApiError,
  FishbowlPartNotFoundError,
  FishbowlCustomerNotFoundError,
} from './types';

const PAGE_SIZE = 100;
const DEFAULT_DETAIL_LIMIT = 500;

export type FBRawSalesOrderItem = Record<string, unknown>;

export type FBRawSalesOrder = Record<string, unknown> & {
  id?: number | string;
  number?: string;
  status?: string;
  customer?: { id?: number | string; name?: string };
  customerName?: string;
  customerPO?: string;
  salesperson?: string | { name?: string };
  salesPerson?: string | { name?: string };
  dateCreated?: string;
  dateScheduled?: string;
  dateIssued?: string;
  dateCompleted?: string;
  total?: number | string;
  subtotal?: number | string;
  taxTotal?: number | string;
  shippingTotal?: number | string;
  currency?: string;
  shipTo?: Record<string, unknown>;
  items?: FBRawSalesOrderItem[];
  lines?: FBRawSalesOrderItem[];
  soItems?: FBRawSalesOrderItem[];
  salesOrderItems?: FBRawSalesOrderItem[];
}

type GetAllSalesOrdersOptions = {
  hydrateDetails?: boolean;
  detailLimit?: number;
}

export type SalesOrdersPage = {
  results: FBRawSalesOrder[];
  totalPages: number;
  totalCount?: number;
  pageNumber: number;
  pageSize: number;
}

function toTimestamp(value: unknown): number {
  if (!value) return 0;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : 0;
}

function salesOrderSortValue(order: FBRawSalesOrder): number {
  return Math.max(
    toTimestamp(order.dateCreated),
    toTimestamp(order.dateIssued),
    toTimestamp(order.dateCompleted),
    toTimestamp(order.lastModified && typeof order.lastModified === 'object'
      ? (order.lastModified as Record<string, unknown>).dateLastModified
      : null)
  );
}

/**
 * Create a new Sales Order in Fishbowl.
 * Throws typed errors for part-not-found and customer-not-found cases.
 */
export async function createSalesOrder(
  client: FishbowlClient,
  payload: FBSalesOrderPayload
): Promise<FBSalesOrderResult> {
  try {
    return await client.request<FBSalesOrderResult>(
      'POST',
      '/api/sales-orders',
      payload
    );
  } catch (err) {
    if (err instanceof FishbowlApiError) {
      const msg =
        typeof err.responseBody === 'string'
          ? err.responseBody.toLowerCase()
          : JSON.stringify(err.responseBody ?? '').toLowerCase();

      // Detect part-not-found errors
      if (msg.includes('part') && (msg.includes('not found') || msg.includes('invalid'))) {
        const match = msg.match(/part\s*(?:number)?\s*[":]*\s*([A-Z0-9-]+)/i);
        throw new FishbowlPartNotFoundError(match?.[1] ?? 'unknown');
      }

      // Detect customer-not-found errors
      if (msg.includes('customer') && msg.includes('not found')) {
        throw new FishbowlCustomerNotFoundError(payload.customer.name);
      }
    }
    throw err;
  }
}

/**
 * Fetch every Fishbowl Sales Order visible to the REST API.
 * Fishbowl's API has varied response keys across versions, so this accepts the
 * standard paginated shape and a few common aliases.
 */
export async function getAllSalesOrders(
  client: FishbowlClient,
  options: GetAllSalesOrdersOptions = {}
): Promise<FBRawSalesOrder[]> {
  const allOrders: FBRawSalesOrder[] = [];
  let pageNumber = 1;
  let totalPages = 1;

  while (pageNumber <= totalPages) {
    const page = await client.request<
      FBPaginatedResponse<FBRawSalesOrder> & {
        data?: FBRawSalesOrder[];
        salesOrders?: FBRawSalesOrder[];
      }
    >(
      'GET',
      `/api/sales-orders?pageNumber=${pageNumber}&pageSize=${PAGE_SIZE}`
    );

    totalPages = Number(page.totalPages ?? 1);
    allOrders.push(...(page.results ?? page.salesOrders ?? page.data ?? []));
    pageNumber++;
  }

  if (options.hydrateDetails) {
    const detailLimit = Math.max(0, options.detailLimit ?? DEFAULT_DETAIL_LIMIT);
    const detailCandidates = [...allOrders]
      .filter((order) => order.id !== undefined && order.id !== null)
      .sort((a, b) => salesOrderSortValue(b) - salesOrderSortValue(a))
      .slice(0, detailLimit);
    const detailById = new Map<string, FBRawSalesOrder>();

    for (const order of detailCandidates) {
      try {
        const detail = await getSalesOrderById(client, order.id as string | number);
        if (detail) detailById.set(String(order.id), detail);
      } catch {
        // Keep header sync useful even when a detail row is missing or malformed.
      }
    }

    return allOrders.map((order) => {
      const detail = detailById.get(String(order.id));
      return detail ? { ...order, ...detail } : order;
    });
  }

  return allOrders;
}

export async function getSalesOrdersPage(
  client: FishbowlClient,
  pageNumber: number,
  pageSize = PAGE_SIZE
): Promise<SalesOrdersPage> {
  const page = await client.request<
    FBPaginatedResponse<FBRawSalesOrder> & {
      data?: FBRawSalesOrder[];
      salesOrders?: FBRawSalesOrder[];
      totalCount?: number;
    }
  >(
    'GET',
    `/api/sales-orders?pageNumber=${pageNumber}&pageSize=${pageSize}`
  );

  return {
    results: page.results ?? page.salesOrders ?? page.data ?? [],
    totalPages: Number(page.totalPages ?? 1),
    totalCount: page.totalCount,
    pageNumber: Number(page.pageNumber ?? pageNumber),
    pageSize: Number(page.pageSize ?? pageSize),
  };
}

export async function getSalesOrderById(
  client: FishbowlClient,
  id: string | number
): Promise<FBRawSalesOrder | null> {
  try {
    return await client.request<FBRawSalesOrder>(
      'GET',
      `/api/sales-orders/${encodeURIComponent(String(id))}`
    );
  } catch (err) {
    if (err instanceof FishbowlApiError && err.statusCode === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Look up a Sales Order by its SO number (e.g., "SO-10045").
 * Returns the raw Fishbowl response or null if not found.
 */
export async function getSalesOrderByNumber(
  client: FishbowlClient,
  soNumber: string
): Promise<FBRawSalesOrder | null> {
  try {
    const response = await client.request<
      FBRawSalesOrder |
      FBPaginatedResponse<FBRawSalesOrder> & {
        data?: FBRawSalesOrder[];
        salesOrders?: FBRawSalesOrder[];
      }
    >(
      'GET',
      `/api/sales-orders?number=${encodeURIComponent(soNumber)}`
    );
    if ('results' in response || 'data' in response || 'salesOrders' in response) {
      const page = response as {
        results?: FBRawSalesOrder[];
        salesOrders?: FBRawSalesOrder[];
        data?: FBRawSalesOrder[];
      };
      return page.results?.[0] ?? page.salesOrders?.[0] ?? page.data?.[0] ?? null;
    }
    return response;
  } catch (err) {
    if (err instanceof FishbowlApiError && err.statusCode === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Check if a customer exists in Fishbowl by name.
 * Returns the customer object if found, null if not.
 */
export async function findCustomerByName(
  client: FishbowlClient,
  customerName: string
): Promise<{ id: number; name: string } | null> {
  try {
    interface CustomerSearchResult {
      results: Array<{ id: number; name: string }>;
    }
    const data = await client.request<CustomerSearchResult>(
      'GET',
      `/api/customers?name=${encodeURIComponent(customerName)}`
    );
    return data.results[0] ?? null;
  } catch (err) {
    if (err instanceof FishbowlApiError && err.statusCode === 404) {
      return null;
    }
    throw err;
  }
}

/**
 * Create a customer in Fishbowl.
 * Used when a Salesforce Account doesn't exist in Fishbowl yet.
 */
export async function createCustomer(
  client: FishbowlClient,
  data: {
    name: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  }
): Promise<{ id: number; name: string }> {
  return client.request<{ id: number; name: string }>(
    'POST',
    '/api/customers',
    data
  );
}
