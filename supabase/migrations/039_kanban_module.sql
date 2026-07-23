-- Kanban module: Zeus integration pass.
--
-- The kanban_* tables (users/boards/board_members/columns/tasks/
-- task_assignees/comments/activity) were created by the standalone prototype
-- (MCP migrations kanban_module_schema + kanban_module_seed). This migration
-- adopts them into Zeus:
--   1. kanban_users gains profile_id so directory people can be linked to
--      real auth users (profiles). Identity resolution: profile_id match
--      first, then email match.
--   2. RLS is retiered to the migration-026 pattern (Class O — staff+ read,
--      no client writes; the app reads/writes through the service-role
--      client). The prototype's zeus_pub USING(true) policies and grants are
--      dropped.

ALTER TABLE kanban_users
  ADD COLUMN IF NOT EXISTS profile_id uuid UNIQUE REFERENCES profiles(id) ON DELETE SET NULL;

-- Auto-link any directory rows whose email matches a real profile.
UPDATE kanban_users ku
SET profile_id = p.id
FROM profiles p
WHERE ku.profile_id IS NULL
  AND lower(ku.email) = lower(p.email);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'kanban_users','kanban_boards','kanban_board_members','kanban_columns',
    'kanban_tasks','kanban_task_assignees','kanban_comments','kanban_activity'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS zeus_pub_all ON %I', t);
    EXECUTE format('REVOKE ALL ON %I FROM zeus_pub', t);
    EXECUTE format(
      'CREATE POLICY "staff read %s" ON %I FOR SELECT TO authenticated USING (is_staff_up())',
      t, t
    );
  END LOOP;
END $$;
