-- Reduce Supabase pressure from retry scans and Fishbowl SO backfill status checks.

CREATE INDEX IF NOT EXISTS idx_sync_events_retry_due
  ON sync_events(next_retry_at, status)
  WHERE status IN ('failed', 'retrying')
    AND next_retry_at IS NOT NULL;
