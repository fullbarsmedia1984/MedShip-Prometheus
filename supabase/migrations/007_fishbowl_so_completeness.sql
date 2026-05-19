-- ============================================================
-- P7 Fishbowl Sales Order Data Completeness
-- Resumable page backfill, detail hydration queue, and cache quality state.
-- ============================================================

ALTER TABLE fb_sales_orders
  ADD COLUMN IF NOT EXISTS source_page_number INT,
  ADD COLUMN IF NOT EXISTS source_last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS detail_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (detail_status IN ('pending', 'success', 'failed')),
  ADD COLUMN IF NOT EXISTS detail_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS detail_hydrated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS detail_error TEXT,
  ADD COLUMN IF NOT EXISTS data_quality_flags TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS fishbowl_so_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('backfill', 'pages', 'details', 'incremental')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed', 'paused')),
  source_total_pages INT,
  source_page_size INT,
  source_total_headers_estimate INT,
  pages_completed INT DEFAULT 0,
  pages_failed INT DEFAULT 0,
  headers_upserted INT DEFAULT 0,
  details_attempted INT DEFAULT 0,
  details_succeeded INT DEFAULT 0,
  details_failed INT DEFAULT 0,
  items_upserted INT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  raw_summary JSONB
);

CREATE TABLE IF NOT EXISTS fishbowl_so_page_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_number INT NOT NULL,
  page_size INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'success', 'failed', 'paused')),
  attempts INT DEFAULT 0,
  headers_found INT DEFAULT 0,
  headers_upserted INT DEFAULT 0,
  details_queued INT DEFAULT 0,
  last_run_id UUID REFERENCES fishbowl_so_sync_runs(id) ON DELETE SET NULL,
  last_error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (page_number, page_size)
);

CREATE TABLE IF NOT EXISTS fishbowl_so_detail_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fishbowl_id TEXT,
  so_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'success', 'failed', 'paused')),
  attempts INT DEFAULT 0,
  line_count INT DEFAULT 0,
  last_error TEXT,
  last_attempted_at TIMESTAMPTZ,
  hydrated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fb_so_source_page ON fb_sales_orders(source_page_number);
CREATE INDEX IF NOT EXISTS idx_fb_so_detail_status ON fb_sales_orders(detail_status);
CREATE INDEX IF NOT EXISTS idx_fb_so_quality_flags ON fb_sales_orders USING gin(data_quality_flags);
CREATE INDEX IF NOT EXISTS idx_fishbowl_so_detail_queue_status ON fishbowl_so_detail_queue(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_fishbowl_so_page_checkpoints_status ON fishbowl_so_page_checkpoints(status, page_number);
CREATE INDEX IF NOT EXISTS idx_fishbowl_so_sync_runs_started ON fishbowl_so_sync_runs(started_at DESC);

ALTER TABLE fishbowl_so_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fishbowl_so_page_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE fishbowl_so_detail_queue ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'fishbowl_so_sync_runs'
      AND policyname = 'auth read fishbowl_so_sync_runs'
  ) THEN
    CREATE POLICY "auth read fishbowl_so_sync_runs"
      ON fishbowl_so_sync_runs FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'fishbowl_so_page_checkpoints'
      AND policyname = 'auth read fishbowl_so_page_checkpoints'
  ) THEN
    CREATE POLICY "auth read fishbowl_so_page_checkpoints"
      ON fishbowl_so_page_checkpoints FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'fishbowl_so_detail_queue'
      AND policyname = 'auth read fishbowl_so_detail_queue'
  ) THEN
    CREATE POLICY "auth read fishbowl_so_detail_queue"
      ON fishbowl_so_detail_queue FOR SELECT TO authenticated USING (true);
  END IF;
END $$;
