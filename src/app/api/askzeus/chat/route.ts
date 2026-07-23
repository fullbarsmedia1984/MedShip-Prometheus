import { NextRequest, NextResponse } from 'next/server'
import { ASKZEUS_API_AUTH_OPTIONS, requireApiAuth } from '@/lib/auth'
import {
  askZeusModel,
  runAskZeusAgent,
  type AgentRunOutput,
  type ChatMessage,
} from '@/lib/askzeus/agent'
import {
  appendMessages,
  createConversation,
  getConversationMessages,
  getOwnedConversation,
  toChatHistory,
} from '@/lib/askzeus/persistence'
import { getActiveKnowledge } from '@/lib/askzeus/knowledge'
import { toolsForRole, type ToolContext } from '@/lib/askzeus/tools'
import type { AskZeusEvent } from '@/lib/askzeus/types'
import { getRepAliases } from '@/lib/reps'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
// The agent loop can run several model rounds; give it room on Railway.
export const maxDuration = 300

const MESSAGE_MAX_CHARS = 4000

function sseFrame(event: AskZeusEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

async function displayNameFor(userId: string | null, email: string | null) {
  if (!userId) return email
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle()
    return (data?.display_name as string | undefined) || email
  } catch {
    return email
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApiAuth(ASKZEUS_API_AUTH_OPTIONS)
    if (!auth.authorized) return auth.response
    if (!auth.role) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const role = auth.role

    const body = (await request.json().catch(() => null)) as {
      conversationId?: string
      message?: string
    } | null
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }
    if (message.length > MESSAGE_MAX_CHARS) {
      return NextResponse.json(
        { error: `message exceeds ${MESSAGE_MAX_CHARS} characters` },
        { status: 400 }
      )
    }
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json(
        { error: 'AskZeus is not configured (missing OPENROUTER_API_KEY)' },
        { status: 503 }
      )
    }

    // Dev auth bypass has no real user; run the chat without persistence.
    const userId = auth.user?.id ?? null
    const canPersist = userId !== null

    const userMessage: ChatMessage = { role: 'user', content: message }
    let conversationId = 'ephemeral'
    let history: ChatMessage[] = []

    if (canPersist) {
      if (body?.conversationId) {
        const conversation = await getOwnedConversation(body.conversationId, userId)
        if (!conversation) {
          return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
        }
        conversationId = conversation.id
        history = toChatHistory(await getConversationMessages(conversationId))
      } else {
        const conversation = await createConversation(userId, message)
        conversationId = conversation.id
      }
      await appendMessages(conversationId, [{ message: userMessage }])
    }

    const repAliases = role === 'sales_rep' && userId ? await getRepAliases(userId) : null
    const toolContext: ToolContext = { role, userId, repAliases }
    const tools = toolsForRole(role)
    const [displayName, knowledge] = await Promise.all([
      displayNameFor(userId, auth.user?.email ?? null),
      getActiveKnowledge(),
    ])

    const agentHistory: ChatMessage[] = [...history, userMessage]

    const output: AgentRunOutput = {
      newMessages: [],
      stopReason: null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(sseFrame({ type: 'meta', conversationId }))
        try {
          const agent = runAskZeusAgent(
            {
              history: agentHistory,
              tools,
              toolContext,
              role,
              displayName,
              knowledge,
              conversationId,
              signal: request.signal,
            },
            output
          )
          for await (const event of agent) {
            controller.enqueue(sseFrame(event))
          }
        } catch (error) {
          if (!request.signal.aborted) {
            const message =
              error instanceof Error ? error.message : 'Internal error'
            try {
              controller.enqueue(
                sseFrame({ type: 'error', code: 'internal', message })
              )
            } catch {
              // stream already closed
            }
          }
        } finally {
          // Persist whatever complete rounds we produced, even on abort/error.
          if (canPersist && output.newMessages.length > 0) {
            const model = askZeusModel()
            const lastIndex = output.newMessages.length - 1
            await appendMessages(
              conversationId,
              output.newMessages.map((msg, index) => ({
                message: msg,
                ...(msg.role === 'assistant' && index === lastIndex
                  ? {
                      model,
                      inputTokens: output.usage.inputTokens,
                      outputTokens: output.usage.outputTokens,
                    }
                  : {}),
              }))
            ).catch((error) => {
              console.error('askzeus message persistence failed:', error)
            })
          }
          try {
            controller.close()
          } catch {
            // already closed
          }
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        // Railway/nginx: do not buffer SSE frames.
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
