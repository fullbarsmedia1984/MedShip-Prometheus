import { NextRequest, NextResponse } from 'next/server'
import { ESTIMATOR_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import { getEstimatorLlmProvider } from '@/lib/llm'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ESTIMATOR_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response

    const body = (await request.json()) as { partNumber?: string; description?: string }
    if (!body.partNumber) {
      return NextResponse.json({ error: 'partNumber is required' }, { status: 400 })
    }

    const llm = getEstimatorLlmProvider()
    if (!llm.available) {
      return NextResponse.json(
        { suggestion: null, provider: llm.name, message: 'LLM assist is not configured' },
        { status: 200 }
      )
    }

    const suggestion = await llm.suggestDimensions({
      partNumber: body.partNumber,
      description: body.description ?? body.partNumber,
    })
    return NextResponse.json({ suggestion, provider: llm.name })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
