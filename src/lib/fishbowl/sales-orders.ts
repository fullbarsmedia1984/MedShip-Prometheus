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
  client: FishbowlClient
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

  return allOrders;
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
