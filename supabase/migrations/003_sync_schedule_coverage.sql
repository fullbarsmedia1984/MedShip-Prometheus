-- Ensure live orchestration status has rows for all automations that the app surfaces.
-- Empty cron_expression means event-driven/on-demand; the app labels it as On-demand.
INSERT INTO sync_schedules (automation, cron_expression) VALUES
    ('P1_OPP_TO_SO', '*/2 * * * *'),
    ('P5_QUOTE_PDF', ''),
    ('SF_FULL_SYNC', ''),
    ('SF_INCREMENTAL_SYNC', '*/15 * * * *')
ON CONFLICT (automation) DO NOTHING;
