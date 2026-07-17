-- Apply reviewed Nursing Kit workbook changes and their immutable audit rows
-- in one database transaction. The function is service-role only; callers
-- must preview and digest the source before invoking it.

CREATE OR REPLACE FUNCTION apply_kit_import(
  p_changes JSONB,
  p_digest TEXT,
  p_actor_user_id UUID,
  p_actor_email TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  change JSONB;
  current_row kit_orders%ROWTYPE;
  after_row JSONB;
  operation TEXT;
  so_number_value TEXT;
  applied INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'Kit import changes must be a JSON array';
  END IF;
  IF jsonb_array_length(p_changes) > 250 THEN
    RAISE EXCEPTION 'Kit import is limited to 250 changes';
  END IF;
  IF p_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Kit import digest is invalid';
  END IF;

  FOR change IN SELECT value FROM jsonb_array_elements(p_changes)
  LOOP
    operation := change->>'operation';
    so_number_value := upper(trim(change->>'soNumber'));
    after_row := change->'after';

    IF operation NOT IN ('insert', 'update') THEN
      RAISE EXCEPTION 'Unsupported kit import operation: %', operation;
    END IF;
    IF so_number_value !~ '-KIT$' OR after_row->>'so_number' <> so_number_value THEN
      RAISE EXCEPTION 'Invalid kit import sales order: %', so_number_value;
    END IF;

    SELECT * INTO current_row
    FROM kit_orders
    WHERE so_number = so_number_value
    FOR UPDATE;

    IF operation = 'insert' AND FOUND THEN
      RAISE EXCEPTION 'Kit import preview is stale; % now exists', so_number_value;
    END IF;
    IF operation = 'update' AND NOT FOUND THEN
      RAISE EXCEPTION 'Kit import preview is stale; % no longer exists', so_number_value;
    END IF;
    IF operation = 'update' AND ROW(
      current_row.earliest_need_by,
      current_row.absolute_need_by,
      current_row.transit_days,
      current_row.rep,
      current_row.table_location,
      current_row.notes
    ) IS DISTINCT FROM ROW(
      nullif(change->'before'->>'earliest_need_by', '')::date,
      nullif(change->'before'->>'absolute_need_by', '')::date,
      nullif(change->'before'->>'transit_days', '')::integer,
      change->'before'->>'rep',
      change->'before'->>'table_location',
      change->'before'->>'notes'
    ) THEN
      RAISE EXCEPTION 'Kit import preview is stale; % changed', so_number_value;
    END IF;

    INSERT INTO kit_orders (
      so_number,
      earliest_need_by,
      absolute_need_by,
      transit_days,
      rep,
      table_location,
      notes,
      updated_at,
      updated_by
    ) VALUES (
      so_number_value,
      nullif(after_row->>'earliest_need_by', '')::date,
      nullif(after_row->>'absolute_need_by', '')::date,
      nullif(after_row->>'transit_days', '')::integer,
      after_row->>'rep',
      after_row->>'table_location',
      after_row->>'notes',
      now(),
      p_actor_user_id
    )
    ON CONFLICT (so_number) DO UPDATE SET
      earliest_need_by = EXCLUDED.earliest_need_by,
      absolute_need_by = EXCLUDED.absolute_need_by,
      transit_days = EXCLUDED.transit_days,
      rep = EXCLUDED.rep,
      table_location = EXCLUDED.table_location,
      notes = EXCLUDED.notes,
      updated_at = EXCLUDED.updated_at,
      updated_by = EXCLUDED.updated_by;

    INSERT INTO audit_log (
      actor_user_id,
      actor_email,
      action,
      entity_type,
      entity_id,
      summary,
      diff
    ) VALUES (
      p_actor_user_id,
      p_actor_email,
      CASE WHEN operation = 'insert' THEN 'kit.imported' ELSE 'kit.import_updated' END,
      'kit_order',
      so_number_value,
      format('Nursing Kit Report %s from source row %s', operation, change->>'row'),
      jsonb_build_object(
        'import_digest', p_digest,
        'source_row', nullif(change->>'row', '')::integer,
        'changed_fields', coalesce(change->'changedFields', '[]'::jsonb),
        'before', change->'before',
        'after', after_row
      )
    );

    applied := applied + 1;
  END LOOP;

  RETURN applied;
END;
$$;

REVOKE ALL ON FUNCTION apply_kit_import(JSONB, TEXT, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_kit_import(JSONB, TEXT, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION apply_kit_import(JSONB, TEXT, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION apply_kit_import(JSONB, TEXT, UUID, TEXT) TO service_role;
