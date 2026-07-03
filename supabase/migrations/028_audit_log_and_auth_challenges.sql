-- Phase 3 lifecycle foundation (PRD §6.1, §9).
-- audit_log: who-changed record for user/role/credential/config/roster/pricing
-- changes (who-viewed is intentionally out of scope, decision 10).
-- auth_challenges: app-level email 2FA codes (PRD §6.1 approach b).

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID,
    actor_email TEXT,
    action TEXT NOT NULL,          -- e.g. 'user.invited', 'user.role_changed'
    entity_type TEXT NOT NULL,     -- e.g. 'profile', 'connection_config'
    entity_id TEXT,
    summary TEXT,
    diff JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_user_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Admins and superadmin may read the audit trail; writes are service-role only.
CREATE POLICY "admin read audit_log" ON audit_log
    FOR SELECT TO authenticated
    USING (is_admin_up());

-- Email 2FA challenges. Codes are stored hashed; the plaintext is only ever
-- sent to the user's inbox. Verified/consumed by the service role.
CREATE TABLE auth_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_auth_challenges_user ON auth_challenges(user_id, created_at DESC);

ALTER TABLE auth_challenges ENABLE ROW LEVEL SECURITY;
-- No client policies: only the service role issues and verifies challenges.
