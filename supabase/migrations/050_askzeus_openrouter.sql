-- ============================================================
-- 050: AskZeus on OpenRouter — messages are stored in OpenAI
-- chat format, where tool results are their own role ('tool')
-- rather than Anthropic-style user-turn tool_result blocks.
-- ============================================================

ALTER TABLE askzeus_messages DROP CONSTRAINT IF EXISTS askzeus_messages_role_check;
ALTER TABLE askzeus_messages
  ADD CONSTRAINT askzeus_messages_role_check CHECK (role IN ('user', 'assistant', 'tool'));
