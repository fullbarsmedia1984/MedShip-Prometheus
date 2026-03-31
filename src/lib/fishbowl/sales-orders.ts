// =============================================================================
// Fishbowl Sales Order Operations
// =============================================================================

import type { FishbowlClient } from './client';
import type { FBSalesOrderPayload, FBSalesOrderResult } from '@/types';
import {
  FishbowlApiError,
  FishbowlPartNotFoundError,
  FishbowlCustomerNotFoundError,
} from './types';

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
 * Look up a Sales Order by its SO number (e.g., "SO-10045").
 * Returns the raw Fishbowl response or null if not found.
 */
export async function getSalesOrderByNumber(
  client: FishbowlClient,
  soNumber: string
): Promise<unknown | null> {
  try {
    return await client.request<unknown>(
      'GET',
      `/api/sales-orders?number=${encodeURIComponent(soNumber)}`
    );
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
