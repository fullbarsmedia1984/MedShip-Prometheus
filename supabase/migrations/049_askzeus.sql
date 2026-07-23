-- ============================================================
-- 049: AskZeus chat assistant
-- Tables: askzeus_conversations, askzeus_messages, askzeus_llm_calls
-- Conversations/messages are owned by the signed-in user; every
-- role may use AskZeus, so access is ownership-based (auth.uid()),
-- not tier-based. All writes go through the service-role client.
-- ============================================================

CREATE TABLE IF NOT EXISTS askzeus_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_askzeus_conversations_user
  ON askzeus_conversations(user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS askzeus_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES askzeus_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  -- Anthropic content blocks (text / tool_use / tool_result) as sent/received
  content JSONB NOT NULL,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_askzeus_messages_conversation
  ON askzeus_messages(conversation_id, created_at);

-- Per-API-call audit log, mirroring estimator_llm_calls.
CREATE TABLE IF NOT EXISTS askzeus_llm_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES askzeus_conversations(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  stop_reason TEXT,
  tool_round INTEGER,
  success BOOLEAN NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_askzeus_llm_calls_created_at
  ON askzeus_llm_calls(created_at DESC);

-- ------------------------------------------------------------
-- RLS: owner-scoped reads, service-role-only writes (no client
-- write policies, per repo convention).
-- ------------------------------------------------------------
ALTER TABLE askzeus_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conversations" ON askzeus_conversations
  FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE askzeus_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conversation messages" ON askzeus_messages
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM askzeus_conversations c
      WHERE c.id = askzeus_messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- askzeus_llm_calls: RLS enabled with no policies — service-role only.
ALTER TABLE askzeus_llm_calls ENABLE ROW LEVEL SECURITY;
