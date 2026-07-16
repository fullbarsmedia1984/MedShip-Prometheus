'use client'

// Chat state machine + SSE consumer for AskZeus. POST + ReadableStream reader
// (EventSource can't POST); frames are `data: <json>\n\n`.

import { useCallback, useRef, useState } from 'react'
import type { AskZeusEvent, StoredMessage } from '@/lib/askzeus/types'

export interface ChatActivity {
  toolUseId: string
  name: string
  label: string
  done: boolean
  ok?: boolean
  resultSummary?: string
}

export interface UserTurn {
  kind: 'user'
  text: string
}

export interface AssistantTurn {
  kind: 'assistant'
  text: string
  activities: ChatActivity[]
  streaming: boolean
  thinking: boolean
  /** Set after tool activity so the next round's text starts a new paragraph. */
  pendingBreak?: boolean
  error?: string
}

export type ChatTurn = UserTurn | AssistantTurn

export type ChatStatus = 'idle' | 'streaming'

/**
 * Collapse stored OpenAI-format messages into display turns. Assistant tool
 * loops (assistant w/ tool_calls → tool results → assistant …) merge into one
 * visible assistant turn; 'tool' rows themselves are not rendered.
 */
export function storedMessagesToTurns(messages: StoredMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  for (const message of messages) {
    const body = message.content
    if (message.role === 'tool') continue

    if (message.role === 'user') {
      const text = typeof body.content === 'string' ? body.content : ''
      if (!text) continue
      turns.push({ kind: 'user', text })
      continue
    }

    // Assistant rows: merge consecutive assistant rounds into one turn.
    const last = turns[turns.length - 1]
    const target: AssistantTurn =
      last && last.kind === 'assistant'
        ? last
        : (() => {
            const turn: AssistantTurn = {
              kind: 'assistant',
              text: '',
              activities: [],
              streaming: false,
              thinking: false,
            }
            turns.push(turn)
            return turn
          })()

    const text = typeof body.content === 'string' ? body.content : ''
    if (text) {
      target.text = target.text ? `${target.text}\n\n${text}` : text
    }
    const toolCalls = Array.isArray(body.tool_calls) ? body.tool_calls : []
    for (const call of toolCalls as Array<{
      id?: string
      function?: { name?: string }
    }>) {
      target.activities.push({
        toolUseId: String(call.id ?? `${target.activities.length}`),
        name: String(call.function?.name ?? 'tool'),
        label: String(call.function?.name ?? 'tool'),
        done: true,
        ok: true,
      })
    }
  }
  return turns
}

export function useAskZeusChat(initialConversationId: string | null) {
  const [conversationId, setConversationId] = useState<string | null>(
    initialConversationId
  )
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [status, setStatus] = useState<ChatStatus>('idle')
  const abortRef = useRef<AbortController | null>(null)
  // Fires when a brand-new conversation gets its server id (refresh the list).
  const onConversationCreatedRef = useRef<((id: string) => void) | null>(null)

  const updateLastAssistant = useCallback(
    (updater: (turn: AssistantTurn) => AssistantTurn) => {
      setTurns((prev) => {
        const next = prev.slice()
        for (let i = next.length - 1; i >= 0; i--) {
          const turn = next[i]
          if (turn.kind === 'assistant') {
            next[i] = updater(turn)
            break
          }
        }
        return next
      })
    },
    []
  )

  const handleEvent = useCallback(
    (event: AskZeusEvent, isNewConversation: boolean) => {
      switch (event.type) {
        case 'meta':
          setConversationId(event.conversationId)
          if (isNewConversation && event.conversationId !== 'ephemeral') {
            onConversationCreatedRef.current?.(event.conversationId)
          }
          break
        case 'status':
          updateLastAssistant((turn) => ({
            ...turn,
            thinking: event.state === 'thinking',
          }))
          break
        case 'text_delta':
          updateLastAssistant((turn) => ({
            ...turn,
            thinking: false,
            pendingBreak: false,
            text:
              turn.pendingBreak && turn.text
                ? `${turn.text}\n\n${event.delta}`
                : turn.text + event.delta,
          }))
          break
        case 'tool_start':
          updateLastAssistant((turn) => ({
            ...turn,
            thinking: false,
            pendingBreak: true,
            activities: [
              ...turn.activities,
              {
                toolUseId: event.toolUseId,
                name: event.name,
                label: event.label,
                done: false,
              },
            ],
          }))
          break
        case 'tool_end':
          updateLastAssistant((turn) => ({
            ...turn,
            activities: turn.activities.map((activity) =>
              activity.toolUseId === event.toolUseId
                ? {
                    ...activity,
                    done: true,
                    ok: event.ok,
                    resultSummary: event.resultSummary,
                  }
                : activity
            ),
          }))
          break
        case 'error':
          updateLastAssistant((turn) => ({
            ...turn,
            thinking: false,
            streaming: false,
            error: event.message,
          }))
          break
        case 'done':
          updateLastAssistant((turn) => ({
            ...turn,
            thinking: false,
            streaming: false,
          }))
          break
      }
    },
    [updateLastAssistant]
  )

  const send = useCallback(
    async (message: string) => {
      const trimmed = message.trim()
      if (!trimmed || status === 'streaming') return

      const isNewConversation = conversationId === null
      setStatus('streaming')
      setTurns((prev) => [
        ...prev,
        { kind: 'user', text: trimmed },
        { kind: 'assistant', text: '', activities: [], streaming: true, thinking: false },
      ])

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const response = await fetch('/api/askzeus/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId: conversationId ?? undefined,
            message: trimmed,
          }),
          signal: controller.signal,
        })

        if (!response.ok || !response.body) {
          const detail = await response
            .json()
            .then((data: { error?: string }) => data.error)
            .catch(() => null)
          throw new Error(detail || `Request failed (${response.status})`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data: ')) continue
              try {
                const event = JSON.parse(line.slice(6)) as AskZeusEvent
                handleEvent(event, isNewConversation)
              } catch {
                // skip malformed frame
              }
            }
          }
        }
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError') {
          updateLastAssistant((turn) => ({
            ...turn,
            streaming: false,
            thinking: false,
            error:
              error instanceof Error ? error.message : 'Something went wrong.',
          }))
        }
      } finally {
        abortRef.current = null
        setStatus('idle')
        updateLastAssistant((turn) => ({
          ...turn,
          streaming: false,
          thinking: false,
        }))
      }
    },
    [conversationId, handleEvent, status, updateLastAssistant]
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const reset = useCallback((id: string | null, initialTurns: ChatTurn[]) => {
    abortRef.current?.abort()
    setConversationId(id)
    setTurns(initialTurns)
    setStatus('idle')
  }, [])

  return {
    conversationId,
    turns,
    status,
    send,
    stop,
    reset,
    onConversationCreatedRef,
  }
}
