-- ============================================================
-- 051: AskZeus feedback + knowledge base
-- feedback: per-answer thumbs from users (QA signal)
-- knowledge: admin-curated facts injected into the system prompt
-- Both service-role-only (RLS enabled, no client policies).
-- ============================================================

CREATE TABLE IF NOT EXISTS askzeus_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES askzeus_conversations(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  comment TEXT,
  question TEXT,
  answer_preview TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_askzeus_feedback_created_at
  ON askzeus_feedback(created_at DESC);

CREATE TABLE IF NOT EXISTS askzeus_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE askzeus_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE askzeus_knowledge ENABLE ROW LEVEL SECURITY;
