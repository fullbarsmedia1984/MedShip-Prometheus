import { NextResponse } from 'next/server'
import {
  WAREHOUSE_GATE_COOKIE,
  warehouseGateToken,
} from '@/lib/warehouse-board/gate'

export async function POST(request: Request) {
  const password = process.env.WAREHOUSE_BOARD_PASSWORD
  if (!password) {
    return NextResponse.json(
      { ok: false, error: 'Wallboard is not configured' },
      { status: 503 }
    )
  }

  const body = await request.json().catch(() => ({ password: '' }))
  if (body?.password !== password) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set(WAREHOUSE_GATE_COOKIE, warehouseGateToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 90, // 90 days — it's a TV, re-auth quarterly
    path: '/',
  })
  return response
}
