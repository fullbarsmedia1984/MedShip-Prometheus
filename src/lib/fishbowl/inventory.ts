// =============================================================================
// Fishbowl Inventory Operations
// =============================================================================

import type { FishbowlClient } from './client';
import type { FBInventoryItem } from '@/types';
import type { FBPaginatedResponse } from './types';

const PAGE_SIZE = 100;

/**
 * Fetch ALL inventory from Fishbowl, paginating through every page.
 * Returns a flat array of every part with inventory data.
 */
export async function getAllInventory(
  client: FishbowlClient
): Promise<FBInventoryItem[]> {
  const allItems: FBInventoryItem[] = [];
  let pageNumber = 1;
  let totalPages = 1; // will be updated after first response

  while (pageNumber <= totalPages) {
    const page = await client.request<FBPaginatedResponse<FBInventoryItem>>(
      'GET',
      `/api/parts/inventory?pageNumber=${pageNumber}&pageSize=${PAGE_SIZE}`
    );

    totalPages = page.totalPages;
    allItems.push(...page.results);

    console.log(
      `Fetched page ${pageNumber} of ${totalPages} (${allItems.length} records so far)`
    );

    pageNumber++;
  }

  return allItems;
}

/**
 * Fetch inventory for a single part by part number.
 * Returns null if not found.
 */
export async function getInventoryByPartNumber(
  client: FishbowlClient,
  partNumber: string
): Promise<FBInventoryItem | null> {
  const response = await client.request<FBPaginatedResponse<FBInventoryItem>>(
    'GET',
    `/api/parts/inventory?number=${encodeURIComponent(partNumber)}`
  );

  return response.results[0] ?? null;
}

/**
 * Fetch inventory for multiple specific part numbers.
 * More efficient than getAllInventory when you only need a few parts.
 */
export async function getInventoryByPartNumbers(
  client: FishbowlClient,
  partNumbers: string[]
): Promise<FBInventoryItem[]> {
  const results: FBInventoryItem[] = [];

  // Fishbowl doesn't support batch part lookup — fetch one at a time
  for (const partNumber of partNumbers) {
    const item = await getInventoryByPartNumber(client, partNumber);
    if (item) {
      results.push(item);
    }
  }

  return results;
}

/**
 * Validate that a list of part numbers exist in Fishbowl.
 * Used by P1 before creating a sales order — checks all SKUs exist.
 */
export async function validatePartNumbers(
  client: FishbowlClient,
  partNumbers: string[]
): Promise<{ valid: string[]; invalid: string[] }> {
  const found = await getInventoryByPartNumbers(client, partNumbers);
  const foundSet = new Set(found.map((item) => item.partNumber));

  const valid: string[] = [];
  const invalid: string[] = [];

  for (const pn of partNumbers) {
    if (foundSet.has(pn)) {
      valid.push(pn);
    } else {
      invalid.push(pn);
    }
  }

  return { valid, invalid };
}
