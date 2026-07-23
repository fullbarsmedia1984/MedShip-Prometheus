-- ============================================================
-- Sync-event dashboard aggregates (migration 054)
--
-- The integrations and events dashboards previously pulled full
-- sync_events rows (including JSONB payload/response) into Node
-- and aggregated in JS: a 7-day unbounded fetch for the
-- per-automation status cards, and the latest 1,000 rows to
-- compute four KPI numbers. These two functions move that
-- aggregation into Postgres; the DAL calls them through the
-- service-role client via .rpc(), so EXECUTE is granted to
-- service_role only.
--
-- "Telemetry" events (circuit-breaker beacons, prometheus →
-- inngest self-events, dismissed/pending rows) are excluded from
-- outcome counts, mirroring isEventTelemetry() in src/lib/data.ts.
-- Day bucketing uses UTC dates to match the dashboard's
-- toISOString()-based grouping.
-- ============================================================

-- ------------------------------------------------------------
-- Per-automation 7-day rollup for the integration status cards:
-- outcome counts, latest-run info, and a zero-filled daily
-- success/failure sparkline.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_event_automation_rollup()
RETURNS TABLE (
    automation TEXT,
    observed_events BIGINT,
    outcome_success BIGINT,
    outcome_failed BIGINT,
    failed_maxed BIGINT,
    latest_created_at TIMESTAMPTZ,
    latest_duration_ms BIGINT,
    last7days JSONB
)
LANGUAGE sql
STABLE
AS $$
WITH window_start AS (
    -- Start of the UTC day six days ago: a 7-day window including today.
    SELECT ((date_trunc('day', now() AT TIME ZONE 'UTC') - INTERVAL '6 days') AT TIME ZONE 'UTC') AS start_at
),
events AS (
    SELECT
        e.automation,
        e.status,
        e.created_at,
        e.completed_at,
        e.retry_count,
        e.max_retries,
        (
            -- payload.circuitBreaker truthy, prometheus->inngest self-event,
            -- or a dismissed/pending row: telemetry, not a sync outcome.
            COALESCE(e.payload -> 'circuitBreaker', 'null'::jsonb)
                NOT IN ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb)
            OR (e.source_system = 'prometheus' AND e.target_system = 'inngest')
            OR e.status IN ('dismissed', 'pending')
        ) AS is_telemetry
    FROM sync_events e
    CROSS JOIN window_start w
    WHERE e.created_at >= w.start_at
),
agg AS (
    SELECT
        ev.automation,
        COUNT(*) AS observed_events,
        COUNT(*) FILTER (WHERE NOT ev.is_telemetry AND ev.status = 'success') AS outcome_success,
        COUNT(*) FILTER (WHERE NOT ev.is_telemetry AND ev.status = 'failed') AS outcome_failed,
        COUNT(*) FILTER (
            WHERE NOT ev.is_telemetry
              AND ev.status = 'failed'
              AND COALESCE(ev.retry_count, 0) >= COALESCE(ev.max_retries, 0)
        ) AS failed_maxed
    FROM events ev
    GROUP BY ev.automation
),
-- "Latest run" prefers the newest outcome event (success/failed sync) and
-- falls back to the newest event of any kind.
latest AS (
    SELECT DISTINCT ON (ev.automation)
        ev.automation,
        ev.created_at,
        ev.completed_at
    FROM events ev
    ORDER BY
        ev.automation,
        (NOT ev.is_telemetry AND ev.status IN ('success', 'failed')) DESC,
        ev.created_at DESC
),
daily AS (
    SELECT
        ev.automation,
        (ev.created_at AT TIME ZONE 'UTC')::date AS bucket_day,
        COUNT(*) FILTER (WHERE NOT ev.is_telemetry AND ev.status = 'success') AS success_count,
        COUNT(*) FILTER (WHERE NOT ev.is_telemetry AND ev.status = 'failed') AS failed_count
    FROM events ev
    GROUP BY ev.automation, (ev.created_at AT TIME ZONE 'UTC')::date
),
day_grid AS (
    SELECT
        a.automation,
        d.bucket_day::date AS bucket_day
    FROM (SELECT DISTINCT ev.automation FROM events ev) a
    CROSS JOIN generate_series(
        date_trunc('day', now() AT TIME ZONE 'UTC') - INTERVAL '6 days',
        date_trunc('day', now() AT TIME ZONE 'UTC'),
        INTERVAL '1 day'
    ) AS d(bucket_day)
),
spark AS (
    SELECT
        g.automation,
        jsonb_agg(
            jsonb_build_object(
                'date', to_char(g.bucket_day, 'YYYY-MM-DD'),
                'success', COALESCE(dl.success_count, 0),
                'failed', COALESCE(dl.failed_count, 0)
            )
            ORDER BY g.bucket_day
        ) AS last7days
    FROM day_grid g
    LEFT JOIN daily dl
        ON dl.automation = g.automation
       AND dl.bucket_day = g.bucket_day
    GROUP BY g.automation
)
SELECT
    agg.automation,
    agg.observed_events,
    agg.outcome_success,
    agg.outcome_failed,
    agg.failed_maxed,
    latest.created_at AS latest_created_at,
    CASE
        WHEN latest.completed_at IS NULL THEN 0
        ELSE GREATEST(
            ROUND(EXTRACT(EPOCH FROM (latest.completed_at - latest.created_at)) * 1000)::BIGINT,
            0
        )
    END AS latest_duration_ms,
    spark.last7days
FROM agg
JOIN latest ON latest.automation = agg.automation
JOIN spark ON spark.automation = agg.automation;
$$;

REVOKE EXECUTE ON FUNCTION sync_event_automation_rollup() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sync_event_automation_rollup() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_event_automation_rollup() TO service_role;

-- ------------------------------------------------------------
-- Events-page KPI strip: totals, success rate inputs, average
-- duration, and failures today. Aggregates the latest 1,000
-- events and then applies the page filters, matching the
-- previous JS implementation (fetch 1,000, filter, reduce).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_event_kpis(
    p_automation TEXT DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL,
    p_date_from TIMESTAMPTZ DEFAULT NULL,
    p_date_to TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    total BIGINT,
    outcome_success BIGINT,
    outcome_failed BIGINT,
    avg_duration_ms DOUBLE PRECISION,
    failures_today BIGINT
)
LANGUAGE sql
STABLE
AS $$
WITH recent AS (
    SELECT
        e.automation,
        e.status,
        e.created_at,
        e.completed_at,
        e.source_record_id,
        e.target_record_id,
        e.error_message,
        (
            COALESCE(e.payload -> 'circuitBreaker', 'null'::jsonb)
                NOT IN ('null'::jsonb, 'false'::jsonb, '0'::jsonb, '""'::jsonb)
            OR (e.source_system = 'prometheus' AND e.target_system = 'inngest')
            OR e.status IN ('dismissed', 'pending')
        ) AS is_telemetry
    FROM sync_events e
    ORDER BY e.created_at DESC
    LIMIT 1000
),
filtered AS (
    SELECT r.*
    FROM recent r
    WHERE (p_automation IS NULL OR r.automation = p_automation)
      AND (p_status IS NULL OR r.status = p_status)
      AND (p_date_from IS NULL OR r.created_at >= p_date_from)
      AND (p_date_to IS NULL OR r.created_at <= p_date_to)
      AND (
            p_search IS NULL
            OR r.source_record_id ILIKE '%' || p_search || '%'
            OR r.target_record_id ILIKE '%' || p_search || '%'
            OR r.error_message ILIKE '%' || p_search || '%'
      )
)
SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE NOT f.is_telemetry AND f.status = 'success') AS outcome_success,
    COUNT(*) FILTER (WHERE NOT f.is_telemetry AND f.status = 'failed') AS outcome_failed,
    COALESCE(
        AVG(GREATEST(EXTRACT(EPOCH FROM (f.completed_at - f.created_at)) * 1000, 0))
            FILTER (WHERE NOT f.is_telemetry AND f.completed_at IS NOT NULL),
        0
    )::DOUBLE PRECISION AS avg_duration_ms,
    COUNT(*) FILTER (
        WHERE NOT f.is_telemetry
          AND f.status = 'failed'
          AND (f.created_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date
    ) AS failures_today
FROM filtered f;
$$;

REVOKE EXECUTE ON FUNCTION sync_event_kpis(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION sync_event_kpis(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_event_kpis(TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
