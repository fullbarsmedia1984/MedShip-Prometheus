-- Kanban prototype demo-data wipe.
-- Removes the fictional @demo.medshipops.com directory seeded during the
-- prototype (16 users, their personal boards, all seeded tasks/activity).
-- Department boards and their columns are untouched. Real staff get
-- directory rows + personal boards automatically on first sign-in
-- (auto-provisioning in src/lib/kanban/identity.ts).
--
-- Run once in the Supabase SQL editor (Prometheus project).

begin;

delete from kanban_tasks t
where t.created_by in (
    select id from kanban_users where email ilike '%@demo.medshipops.com'
  )
  or t.id in (
    select a.task_id
    from kanban_task_assignees a
    join kanban_users u on u.id = a.user_id
    where u.email ilike '%@demo.medshipops.com'
  );

delete from kanban_activity a
where a.actor_id in (
  select id from kanban_users where email ilike '%@demo.medshipops.com'
);

delete from kanban_boards b
where b.kind = 'personal'
  and b.owner_id in (
    select id from kanban_users where email ilike '%@demo.medshipops.com'
  );

delete from kanban_users where email ilike '%@demo.medshipops.com';

commit;

-- Expect: users_left 0, tasks_left 0, boards_left 8 (departments), memberships_left 0
select
  (select count(*) from kanban_users) as users_left,
  (select count(*) from kanban_boards) as boards_left,
  (select count(*) from kanban_tasks) as tasks_left,
  (select count(*) from kanban_board_members) as memberships_left;
