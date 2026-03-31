import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { InventoryLookupResponse } from '@/types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Inventory lookup API
 *
 * GET /api/inventory?partNumber=ABC123         — exact match, single result or 404
 * GET /api/inventory?search=catheter&limit=20  — ILIKE match on part_number + part_description
 *
 * Returns cached data from inventory_snapshot Supabase table (not live Fishbowl).
 * Includes lastSyncedAt so consumers know data freshness.
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const partNumber = searchParams.get('partNumber');
    const search = searchParams.get('search');
    const rawLimit = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
    const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);

    const supabase = createAdminClient();

    // --- Exact part number lookup ---
    if (partNumber) {
      const { data, error } = await supabase
        .from('inventory_snapshot')
        .select('*')
        .eq('part_number', partNumber)
        .single();

      if (error && error.code !== 'PGRST116') {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (!data) {
        return NextResponse.json(
          { error: 'Part not found', partNumber },
          { status: 404 }
        );
      }

      const item = toResponse(data);
      return NextResponse.json({
        data: [item],
        lastSyncedAt: item.lastSyncedAt,
      });
    }

    // --- Search (ILIKE on part_number and part_description) ---
    if (search) {
      const pattern = `%${search}%`;

      const { data, error } = await supabase
        .from('inventory_snapshot')
        .select('*')
        .or(`part_number.ilike.${pattern},part_description.ilike.${pattern}`)
        .order('part_number')
        .limit(limit);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      const items = (data ?? []).map(toResponse);
      return NextResponse.json({
        data: items,
        lastSyncedAt: latestSync(items),
      });
    }

    // --- Default: paginated list ---
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const { data, error, count } = await supabase
      .from('inventory_snapshot')
      .select('*', { count: 'exact' })
      .order('part_number')
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items = (data ?? []).map(toResponse);
    return NextResponse.json({
      data: items,
      lastSyncedAt: latestSync(items),
      pagination: { total: count ?? 0, limit, offset },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toResponse(row: Record<string, unknown>): InventoryLookupResponse {
  return {
    partNumber: row.part_number as string,
    partDescription: (row.part_description as string) ?? null,
    qtyOnHand: row.qty_on_hand as number,
    qtyAvailable: row.qty_available as number,
    uom: row.uom as string,
    lastSyncedAt: row.last_synced_at as string,
  };
}

function latestSync(items: InventoryLookupResponse[]): string | null {
  if (items.length === 0) return null;
  return items.reduce((latest, item) =>
    item.lastSyncedAt > latest ? item.lastSyncedAt : latest,
    items[0].lastSyncedAt
  );
}
