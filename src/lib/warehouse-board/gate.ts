import 'server-only'
import { createHash } from 'crypto'
import { cookies } from 'next/headers'

// Shared-password gate for the warehouse wallboard. Same approach as the
// storefront site gate: the cookie stores a hash of the password, so rotating
// WAREHOUSE_BOARD_PASSWORD invalidates every screen at once.
export const WAREHOUSE_GATE_COOKIE = 'wh_board'

export function warehouseGateToken(password: string): string {
  return createHash('sha256')
    .update(`${password}:warehouse-board:v1`)
    .digest('hex')
}

export function isWarehouseBoardConfigured(): boolean {
  return Boolean(process.env.WAREHOUSE_BOARD_PASSWORD)
}

export async function hasWarehouseGateAccess(): Promise<boolean> {
  const password = process.env.WAREHOUSE_BOARD_PASSWORD
  if (!password) return false
  const store = await cookies()
  return store.get(WAREHOUSE_GATE_COOKIE)?.value === warehouseGateToken(password)
}
