/**
 * Fishbowl Client Tests
 *
 * Run with: npx vitest run src/lib/fishbowl/__tests__/client.test.ts
 * (requires vitest to be installed)
 *
 * Tests cover:
 * - Client instantiation throws when env vars missing
 * - Login flow and token storage
 * - 401 retry logic
 * - Pagination logic in getAllInventory
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We need to mock env vars before importing the client
const MOCK_BASE_URL = 'http://192.168.1.100:28192';
const MOCK_TOKEN = 'test-token-abc123';

describe('FishbowlClient', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.FISHBOWL_API_URL = MOCK_BASE_URL;
    process.env.FISHBOWL_USERNAME = 'testuser';
    process.env.FISHBOWL_PASSWORD = 'testpass';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // -------------------------------------------------------------------------
  // Instantiation
  // -------------------------------------------------------------------------

  it('throws when FISHBOWL_API_URL is missing', async () => {
    delete process.env.FISHBOWL_API_URL;
    // Dynamic import to pick up env changes
    const { createFishbowlClient } = await import('../client');
    expect(() => createFishbowlClient()).toThrow('FISHBOWL_API_URL');
  });

  it('creates client successfully with valid env vars', async () => {
    const { createFishbowlClient } = await import('../client');
    const client = createFishbowlClient();
    expect(client).toBeDefined();
    expect(client.isAuthenticated()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  it('authenticates and stores token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ token: MOCK_TOKEN, serverVersion: '2024.1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { createFishbowlClient } = await import('../client');
    const client = createFishbowlClient();
    await client.authenticate();

    expect(client.isAuthenticated()).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${MOCK_BASE_URL}/api/session`);
    expect(opts?.method).toBe('POST');

    const body = JSON.parse(opts?.body as string);
    expect(body.username).toBe('testuser');
    expect(body.password).toBe('testpass');
    expect(body.appName).toBeUndefined();
  });

  it('throws FishbowlAuthError on login failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Invalid credentials', { status: 401 })
    );

    const { createFishbowlClient } = await import('../client');
    const client = createFishbowlClient();

    await expect(client.authenticate()).rejects.toThrow('Fishbowl login failed');
  });

  // -------------------------------------------------------------------------
  // 401 Retry Logic
  // -------------------------------------------------------------------------

  it('retries on 401 by re-authenticating', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      // First call: initial authenticate (success)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'old-token' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      // Second call: actual request returns 401 (token expired)
      .mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 })
      )
      // Third call: re-authenticate (success with new token)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'new-token' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      // Fourth call: retry the original request (success)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: 'success' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

    const { createFishbowlClient } = await import('../client');
    const client = createFishbowlClient();
    const result = await client.request<{ data: string }>('GET', '/api/test');

    expect(result).toEqual({ data: 'success' });
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  // -------------------------------------------------------------------------
  // testConnection
  // -------------------------------------------------------------------------

  it('testConnection returns success on healthy connection', async () => {
    vi.spyOn(globalThis, 'fetch')
      // Login
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: MOCK_TOKEN, serverVersion: '2024.1' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      )
      // Inventory page 1 fetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ totalCount: 0, totalPages: 0, pageNumber: 1, pageSize: 1, results: [] }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      );

    const { createFishbowlClient } = await import('../client');
    const client = createFishbowlClient();
    const result = await client.testConnection();

    expect(result.success).toBe(true);
    expect(result.version).toBe('2024.1');
  });

  it('testConnection returns error on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('fetch failed')
    );

    const { createFishbowlClient } = await import('../client');
    const client = createFishbowlClient();
    const result = await client.testConnection();

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Pagination tests (getAllInventory)
// ---------------------------------------------------------------------------

describe('getAllInventory pagination', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.FISHBOWL_API_URL = MOCK_BASE_URL;
    process.env.FISHBOWL_USERNAME = 'testuser';
    process.env.FISHBOWL_PASSWORD = 'testpass';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('paginates through multiple pages and returns all items', async () => {
    const page1Items = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      partNumber: `PART-${String(i + 1).padStart(3, '0')}`,
      partDescription: `Part ${i + 1}`,
      quantity: '10',
      uom: { id: 1, name: 'Each', abbreviation: 'ea' },
    }));

    const page2Items = Array.from({ length: 50 }, (_, i) => ({
      id: i + 101,
      partNumber: `PART-${String(i + 101).padStart(3, '0')}`,
      partDescription: `Part ${i + 101}`,
      quantity: '5',
      uom: { id: 1, name: 'Each', abbreviation: 'ea' },
    }));

    vi.spyOn(globalThis, 'fetch')
      // Login
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: MOCK_TOKEN }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      )
      // Page 1
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          totalCount: 150,
          totalPages: 2,
          pageNumber: 1,
          pageSize: 100,
          results: page1Items,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      )
      // Page 2
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          totalCount: 150,
          totalPages: 2,
          pageNumber: 2,
          pageSize: 100,
          results: page2Items,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

    const { createFishbowlClient } = await import('../client');
    const { getAllInventory } = await import('../inventory');

    const client = createFishbowlClient();
    const items = await getAllInventory(client);

    expect(items).toHaveLength(150);
    expect(items[0].partNumber).toBe('PART-001');
    expect(items[149].partNumber).toBe('PART-150');
  });

  it('handles single page response', async () => {
    const items = [
      { id: 1, partNumber: 'PART-001', quantity: '10', uom: { id: 1, name: 'Each', abbreviation: 'ea' } },
    ];

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: MOCK_TOKEN }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          totalCount: 1,
          totalPages: 1,
          pageNumber: 1,
          pageSize: 100,
          results: items,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      );

    const { createFishbowlClient } = await import('../client');
    const { getAllInventory } = await import('../inventory');

    const client = createFishbowlClient();
    const result = await getAllInventory(client);

    expect(result).toHaveLength(1);
    expect(result[0].partNumber).toBe('PART-001');
  });
});
