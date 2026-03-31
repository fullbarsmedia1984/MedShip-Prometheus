import { NextResponse } from 'next/server';
import { createFishbowlClient } from '@/lib/fishbowl/client';

/**
 * GET /api/health/fishbowl
 * Dedicated Fishbowl connection health check.
 * Used by the Settings page "Test Connection" button.
 */
export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    if (!process.env.FISHBOWL_API_URL) {
      return NextResponse.json({
        connected: false,
        error: 'FISHBOWL_API_URL is not configured',
        timestamp,
      });
    }

    const client = createFishbowlClient();
    const result = await client.testConnection();

    return NextResponse.json({
      connected: result.success,
      version: result.version,
      error: result.error,
      timestamp,
    });
  } catch (err) {
    return NextResponse.json({
      connected: false,
      error: err instanceof Error ? err.message : String(err),
      timestamp,
    });
  }
}
