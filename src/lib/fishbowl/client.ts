// =============================================================================
// Fishbowl REST API Client
// Handles authentication, token refresh, 401 retry, and request lifecycle.
// =============================================================================

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { IFishbowlClient } from '@/types';
import { FishbowlApiError, FishbowlAuthError } from './types';
import type { FBLoginResponse } from './types';

const REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_APP_ID = 20260505;

export type FishbowlConnectionProfile = {
  configured: boolean;
  protocol?: string;
  host?: string;
  port?: string;
  hasExplicitPort: boolean;
  cloudflareAccessEnabled: boolean;
  error?: string;
};

function hasCloudflareAccessConfig() {
  return Boolean(
    process.env.FISHBOWL_CF_ACCESS_CLIENT_ID ||
      process.env.FISHBOWL_CF_ACCESS_CLIENT_SECRET
  );
}

function parseFishbowlApiUrl(apiUrl: string): URL {
  try {
    return new URL(apiUrl);
  } catch {
    throw new Error(
      'Invalid FISHBOWL_API_URL. Set it to a full URL such as ' +
        'https://fishbowl.medshipment.com or http://192.168.1.100:28192.'
    );
  }
}

function getExplicitPort(apiUrl: string): string | undefined {
  const authority = apiUrl.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1];
  const hostPort = authority?.split('@').pop();
  if (!hostPort) return undefined;

  if (hostPort.startsWith('[')) {
    return hostPort.match(/^\[[^\]]+\]:(\d+)$/)?.[1];
  }

  return hostPort.match(/:(\d+)$/)?.[1];
}

export function getFishbowlConnectionProfile(): FishbowlConnectionProfile {
  const apiUrl = process.env.FISHBOWL_API_URL;
  const cloudflareAccessEnabled = hasCloudflareAccessConfig();

  if (!apiUrl) {
    return {
      configured: false,
      hasExplicitPort: false,
      cloudflareAccessEnabled,
      error: 'FISHBOWL_API_URL is not configured',
    };
  }

  try {
    const parsed = parseFishbowlApiUrl(apiUrl);
    const explicitPort = getExplicitPort(apiUrl);
    return {
      configured: true,
      protocol: parsed.protocol.replace(':', ''),
      host: parsed.hostname,
      port: explicitPort,
      hasExplicitPort: Boolean(explicitPort),
      cloudflareAccessEnabled,
    };
  } catch (err) {
    return {
      configured: true,
      hasExplicitPort: false,
      cloudflareAccessEnabled,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function validateFishbowlRuntimeConfig(apiUrl: string) {
  const parsed = parseFishbowlApiUrl(apiUrl);
  const explicitPort = getExplicitPort(apiUrl);
  const hasClientId = Boolean(process.env.FISHBOWL_CF_ACCESS_CLIENT_ID);
  const hasClientSecret = Boolean(process.env.FISHBOWL_CF_ACCESS_CLIENT_SECRET);

  if (hasClientId !== hasClientSecret) {
    throw new Error(
      'Invalid Fishbowl Cloudflare Access configuration. Set both ' +
        'FISHBOWL_CF_ACCESS_CLIENT_ID and FISHBOWL_CF_ACCESS_CLIENT_SECRET, or leave both blank.'
    );
  }

  if (!hasClientId || !hasClientSecret) return;

  if (parsed.protocol !== 'https:') {
    throw new Error(
      'Invalid FISHBOWL_API_URL for Cloudflare Access. Use ' +
        'https://fishbowl.medshipment.com without an explicit port.'
    );
  }

  if (explicitPort) {
    throw new Error(
      'Invalid FISHBOWL_API_URL for Cloudflare Access. Do not include an explicit port; ' +
        'port 2456 is an origin detail and should be hidden behind the tunnel.'
    );
  }
}

export class FishbowlClient implements IFishbowlClient {
  private token: string | null = null;
  private baseUrl: string;
  private username: string;
  private password: string;
  private appName: string;
  private appDescription: string;
  private appId: number;
  private serverVersion: string | null = null;
  private cfAccessClientId: string | null;
  private cfAccessClientSecret: string | null;

  constructor() {
    const apiUrl = process.env.FISHBOWL_API_URL;
    if (!apiUrl) {
      throw new Error(
        'Missing FISHBOWL_API_URL environment variable. ' +
          'Set it to your Fishbowl server address (e.g., http://192.168.1.100:28192).'
      );
    }
    validateFishbowlRuntimeConfig(apiUrl);
    this.baseUrl = apiUrl.replace(/\/+$/, '');
    this.username = process.env.FISHBOWL_USERNAME ?? '';
    this.password = process.env.FISHBOWL_PASSWORD ?? '';
    this.appName = process.env.FISHBOWL_APP_NAME ?? 'MedShip Prometheus';
    this.appDescription =
      process.env.FISHBOWL_APP_DESCRIPTION ??
      'Medical Shipment internal Zeus integration';
    this.appId = Number(process.env.FISHBOWL_APP_ID ?? DEFAULT_APP_ID);
    this.cfAccessClientId = process.env.FISHBOWL_CF_ACCESS_CLIENT_ID ?? null;
    this.cfAccessClientSecret = process.env.FISHBOWL_CF_ACCESS_CLIENT_SECRET ?? null;
  }

  // ---------------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------------

  async authenticate(): Promise<void> {
    const url = `${this.baseUrl}/api/login`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getCfAccessHeaders(),
        },
        body: JSON.stringify({
          appName: this.appName,
          appDescription: this.appDescription,
          appId: this.appId,
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
    this.serverVersion = data.serverVersion ?? data.user?.serverVersion ?? null;
  }

  async logout(): Promise<void> {
    if (!this.token) return;

    const url = `${this.baseUrl}/api/logout`;
    const token = this.token;
    this.token = null;

    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...this.getCfAccessHeaders(),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Logout is best-effort; the important local behavior is to avoid reusing
      // a token after the caller has finished its Fishbowl work.
    }
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
      ...this.getCfAccessHeaders(),
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
  // Data queries — GET /api/data-query with an SQL body
  // Fishbowl requires a GET request carrying the SQL as the body
  // (POST is 405), which fetch() forbids, so this uses node:http(s) directly.
  // ---------------------------------------------------------------------------

  async dataQuery<T>(sql: string): Promise<T> {
    if (!this.token) {
      await this.authenticate();
    }

    const result = await this.executeDataQuery<T>(sql);
    if (result._unauthorized) {
      this.token = null;
      await this.authenticate();
      const retry = await this.executeDataQuery<T>(sql);
      if (retry._unauthorized) {
        throw new FishbowlAuthError(
          'Fishbowl returned 401 after re-authentication'
        );
      }
      return retry.data as T;
    }
    return result.data as T;
  }

  private executeDataQuery<T>(
    sql: string
  ): Promise<{ data?: T; _unauthorized?: boolean }> {
    const url = new URL(`${this.baseUrl}/api/data-query`);
    const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      const req = requestFn(
        url,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/sql',
            'Content-Length': Buffer.byteLength(sql),
            Authorization: `Bearer ${this.token}`,
            ...this.getCfAccessHeaders(),
          },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => {
            if (res.statusCode === 401) {
              resolve({ _unauthorized: true });
              return;
            }
            if (!res.statusCode || res.statusCode >= 400) {
              reject(
                new FishbowlApiError(
                  `Fishbowl data-query error ${res.statusCode}: ${body.slice(0, 300)}`,
                  res.statusCode ?? 0,
                  '/api/data-query',
                  body.slice(0, 1000)
                )
              );
              return;
            }
            try {
              resolve({ data: JSON.parse(body) as T });
            } catch {
              reject(
                new FishbowlApiError(
                  'Fishbowl data-query returned non-JSON',
                  res.statusCode,
                  '/api/data-query',
                  body.slice(0, 300)
                )
              );
            }
          });
        }
      );
      req.on('timeout', () => {
        req.destroy(
          new FishbowlApiError(
            `Fishbowl data-query timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
            0,
            '/api/data-query'
          )
        );
      });
      req.on('error', (err) => reject(this.wrapNetworkError(err, url.toString())));
      req.write(sql);
      req.end();
    });
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
    } finally {
      await this.logout();
    }
  }

  // ---------------------------------------------------------------------------
  // Cloudflare Access headers
  // ---------------------------------------------------------------------------

  private getCfAccessHeaders(): Record<string, string> {
    if (this.cfAccessClientId && this.cfAccessClientSecret) {
      return {
        'CF-Access-Client-Id': this.cfAccessClientId,
        'CF-Access-Client-Secret': this.cfAccessClientSecret,
      };
    }
    return {};
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
