import { NextResponse } from 'next/server';
import {
  createFishbowlClient,
  getFishbowlConnectionProfile,
} from '@/lib/fishbowl/client';
import { requireApiAuth } from '@/lib/auth';

/**
 * GET /api/health/fishbowl
 * Dedicated Fishbowl connection health check.
 * Used by the Settings page "Test Connection" button.
 */
export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.authorized) return auth.response;

  const timestamp = new Date().toISOString();
  const connection = getFishbowlConnectionProfile();

  try {
    if (!process.env.FISHBOWL_API_URL) {
      return NextResponse.json({
        connected: false,
        error: 'FISHBOWL_API_URL is not configured',
        connection,
        timestamp,
      });
    }

    const client = createFishbowlClient();
    const result = await client.testConnection();

    return NextResponse.json({
      connected: result.success,
      version: result.version,
      error: result.error,
      connection,
      timestamp,
    });
  } catch (err) {
    return NextResponse.json({
      connected: false,
      error: err instanceof Error ? err.message : String(err),
      connection,
      timestamp,
    });
  }
}
