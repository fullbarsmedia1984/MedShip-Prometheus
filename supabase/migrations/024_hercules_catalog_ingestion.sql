-- ============================================================
-- Hercules Catalog Ingestion (P10)
-- Resumable, auditable ingestion of Hercules /api/v1/parts/list
-- egress data into the hercules_* supplier catalog staging tables.
--
-- Hercules records stay supplier/manufacturer catalog data; they
-- are NOT canonical Zeus products. Mapping/approval happens later
-- through zeus_product_supplier_mappings (migration 008).
-- ============================================================

-- One row per ingestion run. next_offset is the page checkpoint:
-- a crashed or interrupted run resumes from it instead of restarting.
CREATE TABLE IF NOT EXISTS hercules_ingestion_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource TEXT NOT NULL DEFAULT 'parts'
        CHECK (resource IN ('parts', 'suppliers', 'products')),
    run_type TEXT NOT NULL
        CHECK (run_type IN ('full', 'delta')),
    status TEXT NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
    page_size INT NOT NULL DEFAULT 500 CHECK (page_size BETWEEN 1 AND 500),
    next_offset INT NOT NULL DEFAULT 0 CHECK (next_offset >= 0),
    pages_fetched INT NOT NULL DEFAULT 0,
    total_remote INT,
    items_seen INT NOT NULL DEFAULT 0,
    items_inserted INT NOT NULL DEFAULT 0,
    items_updated INT NOT NULL DEFAULT 0,
    items_rejected INT NOT NULL DEFAULT 0,
    -- Full HerculesImportJobCounters JSON; the INT columns above are
    -- derived from it for cheap dashboard queries.
    counters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Delta runs filter on updatedAt >= updated_since.
    updated_since TIMESTAMPTZ,
    -- Highest source updatedAt observed; becomes the next delta watermark.
    max_source_updated_at TIMESTAMPTZ,
    import_job_id UUID REFERENCES hercules_import_jobs(id) ON DELETE SET NULL,
    last_error TEXT,
    rate_limit_snapshot JSONB,
    triggered_by TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one active run per resource; concurrent runs would fight over
-- the offset cursor and double-consume the rate-limit window.
CREATE UNIQUE INDEX IF NOT EXISTS uq_hercules_ingestion_runs_running
    ON hercules_ingestion_runs(resource)
    WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_hercules_ingestion_runs_started
    ON hercules_ingestion_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_hercules_ingestion_runs_status
    ON hercules_ingestion_runs(status);

-- Records that failed normalization or upsert. The raw source payload
-- is preserved here so no egress data is lost even on rejection.
CREATE TABLE IF NOT EXISTS hercules_ingestion_rejects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES hercules_ingestion_runs(id) ON DELETE CASCADE,
    page_offset INT NOT NULL,
    record_index INT NOT NULL,
    hercules_item_id TEXT,
    error_message TEXT NOT NULL,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hercules_ingestion_rejects_run
    ON hercules_ingestion_rejects(run_id);
CREATE INDEX IF NOT EXISTS idx_hercules_ingestion_rejects_item
    ON hercules_ingestion_rejects(hercules_item_id);

-- Delta-sync watermarks, keyed per resource (e.g. 'parts').
CREATE TABLE IF NOT EXISTS hercules_sync_state (
    resource TEXT PRIMARY KEY
        CHECK (resource IN ('parts', 'suppliers', 'products')),
    last_sync_watermark TIMESTAMPTZ,
    last_completed_run_id UUID REFERENCES hercules_ingestion_runs(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE hercules_ingestion_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hercules_ingestion_rejects ENABLE ROW LEVEL SECURITY;
ALTER TABLE hercules_sync_state ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_ingestion_runs' AND policyname = 'auth read hercules_ingestion_runs'
    ) THEN
        CREATE POLICY "auth read hercules_ingestion_runs" ON hercules_ingestion_runs FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_ingestion_rejects' AND policyname = 'auth read hercules_ingestion_rejects'
    ) THEN
        CREATE POLICY "auth read hercules_ingestion_rejects" ON hercules_ingestion_rejects FOR SELECT TO authenticated USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'hercules_sync_state' AND policyname = 'auth read hercules_sync_state'
    ) THEN
        CREATE POLICY "auth read hercules_sync_state" ON hercules_sync_state FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

-- Surface P10 in the orchestration dashboard. Inserted inactive: the
-- daily delta cron stays off until the initial full import completes
-- and ops flips it on.
INSERT INTO sync_schedules (automation, cron_expression, is_active, records_processed)
VALUES ('P10_HERCULES_CATALOG_INGEST', '0 6 * * *', false, 0)
ON CONFLICT (automation) DO NOTHING;
