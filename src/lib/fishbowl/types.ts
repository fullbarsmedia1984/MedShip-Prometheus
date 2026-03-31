// =============================================================================
// Fishbowl-Specific Types & Error Classes
// =============================================================================

// --- Custom Error Classes ---

export class FishbowlApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public endpoint: string,
    public responseBody?: unknown
  ) {
    super(message);
    this.name = 'FishbowlApiError';
  }
}

export class FishbowlPartNotFoundError extends FishbowlApiError {
  constructor(public partNumber: string) {
    super(
      `Part number "${partNumber}" not found in Fishbowl`,
      404,
      '/api/parts'
    );
    this.name = 'FishbowlPartNotFoundError';
  }
}

export class FishbowlCustomerNotFoundError extends FishbowlApiError {
  constructor(public customerName: string) {
    super(
      `Customer "${customerName}" not found in Fishbowl`,
      404,
      '/api/customers'
    );
    this.name = 'FishbowlCustomerNotFoundError';
  }
}

export class FishbowlAuthError extends FishbowlApiError {
  constructor(message: string = 'Fishbowl authentication failed') {
    super(message, 401, '/api/login');
    this.name = 'FishbowlAuthError';
  }
}

// --- Re-exports for consumers that import from this file ---

export type { FBInventoryItem, FBSalesOrderPayload, FBSalesOrderResult } from '@/types';

// Backwards-compat alias — inngest functions import FBSalesOrder from here
export type { FBSalesOrderPayload as FBSalesOrder } from '@/types';

// --- API Response Types ---

export interface FBPaginatedResponse<T> {
  totalCount: number;
  totalPages: number;
  pageNumber: number;
  pageSize: number;
  results: T[];
}

export interface FBLoginResponse {
  token: string;
  userId?: number;
  fullName?: string;
  serverVersion?: string;
}
