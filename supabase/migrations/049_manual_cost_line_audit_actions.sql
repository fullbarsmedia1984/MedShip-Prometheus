-- ============================================================
-- Manual Cost Line Audit Actions (Contract Pricing native management)
-- Native table edits create/supersede/deactivate individual supplier
-- cost lines outside of import batches. Every such action writes a
-- pricing_publish_events row; extend the action CHECK accordingly.
-- ============================================================

ALTER TABLE pricing_publish_events
    DROP CONSTRAINT IF EXISTS pricing_publish_events_action_check;

ALTER TABLE pricing_publish_events
    ADD CONSTRAINT pricing_publish_events_action_check
    CHECK (action IN (
        'approve_batch',
        'publish_batch',
        'rollback_batch',
        'reject_batch',
        'manual_line_create',
        'manual_line_update',
        'manual_line_deactivate'
    ));
