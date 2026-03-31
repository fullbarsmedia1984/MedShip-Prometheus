import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Inventory lookup API
 *
 * Used by Salesforce Lightning Web Component (LWC) to display
 * real-time inventory levels on Opportunity/Quote pages.
 *
 * GET /api/inventory?partNumber=ABC123
 * GET /api/inventory?partNumbers=ABC123,DEF456,GHI789
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const partNumber = searchParams.get('partNumber')
    const partNumbers = searchParams.get('partNumbers')

    const supabase = createAdminClient()

    if (partNumber) {
      // Single part lookup
      const { data, error } = await supabase
        .from('inventory_snapshot')
        .select('*')
        .eq('part_number', partNumber)
        .single()

      if (error && error.code !== 'PGRST116') {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      if (!data) {
        return NextResponse.json(
          { error: 'Part not found', partNumber },
          { status: 404 }
        )
      }

      return NextResponse.json({
        success: true,
        data: {
          partNumber: data.part_number,
          partDescription: data.part_description,
          qtyOnHand: data.qty_on_hand,
          qtyAllocated: data.qty_allocated,
          qtyAvailable: data.qty_available,
          uom: data.uom,
          location: data.location,
          lastSyncedAt: data.last_synced_at,
        },
      })
    }

    if (partNumbers) {
      // Multiple part lookup
      const parts = partNumbers.split(',').map((p) => p.trim())

      const { data, error } = await supabase
        .from('inventory_snapshot')
        .select('*')
        .in('part_number', parts)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      const inventory = (data || []).map((item) => ({
        partNumber: item.part_number,
        partDescription: item.part_description,
        qtyOnHand: item.qty_on_hand,
        qtyAllocated: item.qty_allocated,
        qtyAvailable: item.qty_available,
        uom: item.uom,
        location: item.location,
        lastSyncedAt: item.last_synced_at,
      }))

      // Check for missing parts
      const foundParts = new Set(inventory.map((i) => i.partNumber))
      const missingParts = parts.filter((p) => !foundParts.has(p))

      return NextResponse.json({
        success: true,
        data: inventory,
        missingParts: missingParts.length > 0 ? missingParts : undefined,
      })
    }

    // No part number specified - return paginated list
    const limit = parseInt(searchParams.get('limit') || '100', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    const { data, error, count } = await supabase
      .from('inventory_snapshot')
      .select('*', { count: 'exact' })
      .order('part_number')
      .range(offset, offset + limit - 1)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: (data || []).map((item) => ({
        partNumber: item.part_number,
        partDescription: item.part_description,
        qtyOnHand: item.qty_on_hand,
        qtyAllocated: item.qty_allocated,
        qtyAvailable: item.qty_available,
        uom: item.uom,
        location: item.location,
        lastSyncedAt: item.last_synced_at,
      })),
      pagination: {
        total: count || 0,
        limit,
        offset,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
