// =============================================================================
// Fishbowl REST API Client
// Handles authentication, token refresh, 401 retry, and request lifecycle.
// =============================================================================

import type { IFishbowlClient } from '@/types';
import { FishbowlApiError, FishbowlAuthError } from './types';
import type { FBLoginResponse } from './types';

const REQUEST_TIMEOUT_MS = 30_000;

export class FishbowlClient implements IFishbowlClient {
  private token: string | null = null;
  private baseUrl: string;
  private username: string;
  private password: string;
  private serverVersion: string | null = null;

  constructor() {
    const apiUrl = process.env.FISHBOWL_API_URL;
    if (!apiUrl) {
      throw new Error(
        'Missing FISHBOWL_API_URL environment variable. ' +
          'Set it to your Fishbowl server address (e.g., http://192.168.1.100:28192).'
      );
    }
    this.baseUrl = apiUrl.replace(/\/+$/, '');
    this.username = process.env.FISHBOWL_USERNAME ?? '';
    this.password = process.env.FISHBOWL_PASSWORD ?? '';
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  async authenticate(): Promise<void> {
    const url = `${this.baseUrl}/api/session`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.username,
          password: this.password,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw this.wrapNetworkError(err, url);
    }

    if (!response.ok) {
      const body = await this.safeReadBody(response);
      throw new FishbowlAuthError(
        `Fishbowl login failed (${response.status}): ${body}`
      );
    }

    const data: FBLoginResponse = await response.json();
    if (!data.token) {
      throw new FishbowlAuthError(
        'Fishbowl login response did not include a token'
      );
    }
    this.token = data.token;
    this.serverVersion = data.serverVersion ?? null;
  }

  isAuthenticated(): boolean {
    return this.token !== null;
  }

  // ---------------------------------------------------------------------------
  // Generic request with 401 auto-retry
  // ---------------------------------------------------------------------------

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.token) {
      await this.authenticate();
    }

    const result = await this.executeRequest<T>(method, path, body);

    // If we got a 401, re-authenticate once and retry
    if (result._unauthorized) {
      this.token = null;
      await this.authenticate();
      const retry = await this.executeRequest<T>(method, path, body);
      if (retry._unauthorized) {
        throw new FishbowlAuthError(
          'Fishbowl returned 401 after re-authentication'
        );
      }
      return retry.data as T;
    }

    return result.data as T;
  }

  private async executeRequest<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ data?: T; _unauthorized?: boolean }> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw this.wrapNetworkError(err, url);
    }

    if (response.status === 401) {
      return { _unauthorized: true };
    }

    if (!response.ok) {
      const responseBody = await this.safeReadBody(response);
      throw new FishbowlApiError(
        `Fishbowl API error ${response.status} on ${method} ${path}: ${responseBody}`,
        response.status,
        path,
        responseBody
      );
    }

    const data: T = await response.json();
    return { data };
  }

  // ---------------------------------------------------------------------------
  // Connection test — authenticates + fetches page 1 of inventory
  // ---------------------------------------------------------------------------

  async testConnection(): Promise<{
    success: boolean;
    error?: string;
    version?: string;
  }> {
    try {
      await this.authenticate();
      // Verify full round-trip with a real data call
      await this.request('GET', '/api/parts/inventory?pageNumber=1&pageSize=1');
      return { success: true, version: this.serverVersion ?? undefined };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private wrapNetworkError(err: unknown, url: string): Error {
    if (err instanceof Error) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        return new FishbowlApiError(
          `Request to Fishbowl timed out after ${REQUEST_TIMEOUT_MS / 1000}s: ${url}`,
          0,
          url
        );
      }
      if (
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('fetch failed')
      ) {
        return new FishbowlApiError(
          `Could not connect to Fishbowl at ${url}. ` +
            'Ensure the server is running and accessible from this network.',
          0,
          url
        );
      }
      return new FishbowlApiError(err.message, 0, url);
    }
    return new FishbowlApiError(String(err), 0, url);
  }

  private async safeReadBody(response: Response): Promise<string> {
    try {
      return await response.text();
    } catch {
      return response.statusText;
    }
  }
}

// =============================================================================
// Factory function (spec requirement)
// =============================================================================

export function createFishbowlClient(): FishbowlClient {
  return new FishbowlClient();
}

// Backwards-compat alias used by inngest functions
export function getFishbowlClient(): FishbowlClient {
  return createFishbowlClient();
}

// Backwards-compat export used by /api/health
export async function testFishbowlConnection(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const client = createFishbowlClient();
    return await client.testConnection();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
