'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { History, MessageSquarePlus, Trash2, X, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AppRole } from '@/lib/auth'
import type { ConversationSummary, StoredMessage } from '@/lib/askzeus/types'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { StarterPrompts } from './StarterPrompts'
import { storedMessagesToTurns, useAskZeusChat } from './useAskZeusChat'

function EmptyState({
  role,
  onPick,
}: {
  role: AppRole
  onPick: (prompt: string) => void
}) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-8 overflow-hidden px-4">
      {/* Aurora wash — AskZeus's signature backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 dark:opacity-40"
        style={{
          background:
            'radial-gradient(600px 280px at 50% 18%, color-mix(in srgb, #1E98D5 22%, transparent), transparent 70%), radial-gradient(420px 220px at 72% 60%, color-mix(in srgb, #0FA62C 10%, transparent), transparent 70%)',
        }}
      />
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative flex flex-col items-center gap-3 text-center"
      >
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-medship-primary to-medship-primary-dark shadow-lg shadow-medship-primary/25">
          <Zap className="h-7 w-7 text-white" fill="currentColor" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-foreground">
          Ask<span className="text-medship-primary">Zeus</span>
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Ask anything about orders, customers, revenue, inventory, and warehouse
          operations — answered from live Zeus data.
        </p>
      </motion.div>
      <div className="relative">
        <StarterPrompts role={role} onPick={onPick} />
      </div>
    </div>
  )
}

export function ChatShell({ role }: { role: AppRole }) {
  const chat = useAskZeusChat(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loadingConversation, setLoadingConversation] = useState<string | null>(null)

  const refreshConversations = useCallback(async () => {
    try {
      const response = await fetch('/api/askzeus/conversations')
      if (!response.ok) return
      const data = (await response.json()) as { conversations: ConversationSummary[] }
      setConversations(data.conversations ?? [])
    } catch {
      // list is non-critical; leave as-is
    }
  }, [])

  useEffect(() => {
    void refreshConversations()
  }, [refreshConversations])

  // When the server mints an id for a fresh conversation, refresh the list.
  chat.onConversationCreatedRef.current = () => {
    void refreshConversations()
  }

  const openConversation = useCallback(
    async (id: string) => {
      setLoadingConversation(id)
      try {
        const response = await fetch(`/api/askzeus/conversations/${id}`)
        if (!response.ok) return
        const data = (await response.json()) as { messages: StoredMessage[] }
        chat.reset(id, storedMessagesToTurns(data.messages ?? []))
        setHistoryOpen(false)
      } finally {
        setLoadingConversation(null)
      }
    },
    [chat]
  )

  const newChat = useCallback(() => {
    chat.reset(null, [])
    setHistoryOpen(false)
  }, [chat])

  const removeConversation = useCallback(
    async (id: string) => {
      await fetch(`/api/askzeus/conversations/${id}`, { method: 'DELETE' }).catch(
        () => null
      )
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (chat.conversationId === id) {
        chat.reset(null, [])
      }
    },
    [chat]
  )

  const conversationList = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={newChat}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-medship-primary px-3 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
        >
          <MessageSquarePlus className="h-4 w-4" />
          New chat
        </button>
        <button
          type="button"
          onClick={() => setHistoryOpen(false)}
          className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-muted lg:hidden"
          aria-label="Close history"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            No conversations yet
          </p>
        )}
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={cn(
              'group flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors',
              chat.conversationId === conversation.id
                ? 'bg-medship-primary/10 text-medship-primary'
                : 'text-foreground hover:bg-muted'
            )}
          >
            <button
              type="button"
              onClick={() => void openConversation(conversation.id)}
              disabled={loadingConversation === conversation.id}
              className="min-w-0 flex-1 truncate text-left text-sm"
              title={conversation.title}
            >
              {conversation.title}
            </button>
            <button
              type="button"
              onClick={() => void removeConversation(conversation.id)}
              className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-medship-danger group-hover:opacity-100"
              aria-label={`Delete "${conversation.title}"`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1">
      {/* Conversation history — persistent on desktop, sheet on mobile */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-card lg:block">
        {conversationList}
      </aside>
      {historyOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setHistoryOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 border-r border-border bg-card shadow-xl">
            {conversationList}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 lg:hidden">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            <History className="h-3.5 w-3.5" />
            History
          </button>
        </div>

        {chat.turns.length === 0 ? (
          <EmptyState role={role} onPick={(prompt) => void chat.send(prompt)} />
        ) : (
          <MessageList turns={chat.turns} />
        )}

        <Composer
          status={chat.status}
          onSend={(message) => void chat.send(message)}
          onStop={chat.stop}
        />
      </div>
    </div>
  )
}
