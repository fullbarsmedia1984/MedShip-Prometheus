-- Reconciled from live DB (Phase 0, PRD §12): applied 2026-06-25 as version
-- 20260625154525 "salesforce_call_activities" via MCP apply_migration,
-- but never committed to the repo. Recorded verbatim for repo/schema parity.
-- Do NOT re-apply to the production project.

-- Salesforce RingDNA call activity cache.
-- Dashboard-safe call metrics sourced primarily from Task.TaskSubtype = 'Call'.
CREATE TABLE IF NOT EXISTS sf_call_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sf_id TEXT NOT NULL UNIQUE,
    activity_type TEXT NOT NULL,
    owner_sf_id TEXT,
    activity_date DATE,
    created_date TIMESTAMPTZ,
    last_modified_date TIMESTAMPTZ,
    task_subtype TEXT,
    call_type TEXT,
    call_disposition TEXT,
    profile_call_type TEXT,
    profile_call_outcome TEXT,
    products_discussed TEXT,
    program_size TEXT,
    budget_timeframe TEXT,
    follow_up_date DATE,
    converted_to_opp BOOLEAN DEFAULT false,
    related_opportunity_sf_id TEXT,
    ringdna_direction TEXT,
    ringdna_duration_min DECIMAL(8,2),
    ringdna_connected BOOLEAN DEFAULT false,
    ringdna_rating DECIMAL(5,2),
    ringdna_voicemail BOOLEAN DEFAULT false,
    ringdna_keywords TEXT,
    ringdna_start_time TIMESTAMPTZ,
    ringdna_disposition TEXT,
    calendly_no_show BOOLEAN DEFAULT false,
    calendly_rescheduled BOOLEAN DEFAULT false,
    raw_data JSONB,
    last_synced_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sf_call_activities_owner ON sf_call_activities(owner_sf_id);
CREATE INDEX IF NOT EXISTS idx_sf_call_activities_date ON sf_call_activities(activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_sf_call_activities_modified ON sf_call_activities(last_modified_date DESC);
CREATE INDEX IF NOT EXISTS idx_sf_call_activities_task_subtype ON sf_call_activities(task_subtype);
CREATE INDEX IF NOT EXISTS idx_sf_call_activities_connected ON sf_call_activities(ringdna_connected);
CREATE INDEX IF NOT EXISTS idx_sf_call_activities_disposition ON sf_call_activities(ringdna_disposition);
CREATE INDEX IF NOT EXISTS idx_sf_call_activities_direction ON sf_call_activities(ringdna_direction);
CREATE INDEX IF NOT EXISTS idx_sf_call_activities_owner_date ON sf_call_activities(owner_sf_id, activity_date DESC);

ALTER TABLE sf_call_activities ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'sf_call_activities'
          AND policyname = 'auth read sf call activities'
    ) THEN
        CREATE POLICY "auth read sf call activities"
        ON sf_call_activities
        FOR SELECT TO authenticated
        USING (true);
    END IF;
END $$;

INSERT INTO sf_sync_state (table_name)
VALUES ('sf_call_activities')
ON CONFLICT (table_name) DO NOTHING;
