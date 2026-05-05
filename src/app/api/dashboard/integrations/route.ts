import { NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth'
import { getIntegrationStatus, getConnectionConfigs } from '@/lib/data'

export async function GET() {
  try {
    const auth = await requireApiAuth()
    if (!auth.authorized) return auth.response

    const [integrations, connections] = await Promise.all([
      getIntegrationStatus(),
      getConnectionConfigs(),
    ])

    return NextResponse.json({ integrations, connections })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
