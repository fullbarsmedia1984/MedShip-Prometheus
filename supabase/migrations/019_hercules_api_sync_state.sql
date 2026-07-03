-- ============================================================
-- Hercules API sync state / checkpoints
-- Persistent resumability for /api/v1/parts/list page backfills.
-- ============================================================

CREATE TABLE IF NOT EXISTS hercules_api_sync_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key TEXT NOT NULL UNIQUE,
    supplier_code TEXT,
    phase TEXT NOT NULL DEFAULT 'full_backfill'
        CHECK (phase IN ('full_backfill', 'delta')),
    status TEXT NOT NULL DEFAULT 'idle'
        CHECK (status IN ('idle', 'running', 'success', 'failed', 'partial')),
    page_limit INT NOT NULL DEFAULT 500 CHECK (page_limit > 0 AND page_limit <= 500),
    next_offset INT CHECK (next_offset IS NULL OR next_offset >= 0),
    backfill_started_at TIMESTAMPTZ,
    backfill_completed_at TIMESTAMPTZ,
    delta_cursor TIMESTAMPTZ,
    last_processed_updated_at TIMESTAMPTZ,
    last_import_job_id UUID REFERENCES hercules_import_jobs(id) ON DELETE SET NULL,
    last_error TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hercules_api_sync_states_supplier
    ON hercules_api_sync_states(supplier_code);

CREATE INDEX IF NOT EXISTS idx_hercules_api_sync_states_status
    ON hercules_api_sync_states(status);

CREATE INDEX IF NOT EXISTS idx_hercules_api_sync_states_delta_cursor
    ON hercules_api_sync_states(delta_cursor)
    WHERE delta_cursor IS NOT NULL;

ALTER TABLE hercules_api_sync_states ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'hercules_api_sync_states'
          AND policyname = 'auth read hercules_api_sync_states'
    ) THEN
        CREATE POLICY "auth read hercules_api_sync_states"
            ON hercules_api_sync_states FOR SELECT TO authenticated USING (true);
    END IF;
END $$;
