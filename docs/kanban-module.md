# Kanban module

Operational task boards for every department, at **/dashboard/kanban**. Every
department gets a board; every directory person gets a private board; command
(CEO/COO tier) sees everything.

## Access model

| Who | Sees | Manages members |
| --- | --- | --- |
| `superadmin` / `admin` app role, or a linked directory person with job role CEO/COO | Every department + every individual board | Yes (all boards) |
| Linked directory person | Department boards they're a member of + their own personal board | Only boards where they're a `manager` (e.g. Warehouse Ops Manager on Warehouse) |
| Signed-in user with no directory link | Nothing (empty state with instructions) | — |

All authorization is enforced server-side (`src/lib/kanban/queries.ts` +
`identity.ts`); the API routes in `src/app/api/kanban/*` are guarded by
`requireApiAuth` (all signed-in roles) plus per-board checks.

## Identity: profiles ↔ kanban_users

`kanban_users` is the people directory (name, email, one of 14 job roles,
avatar color). It is intentionally separate from `profiles` — departments are
staffed by people who may not have Zeus logins yet.

A signed-in user is resolved to a directory person by:
1. `kanban_users.profile_id = auth user id`, else
2. case-insensitive email match (the link is persisted on first hit).

To onboard someone: create their `kanban_users` row (or reuse a seeded one),
set `profile_id` to their profiles id (or just use the same email), and add
them to boards via the board's **members** dialog.

## Data model

`kanban_users`, `kanban_boards` (`department` | `personal`),
`kanban_board_members` (`manager` | `member`), `kanban_columns` (WIP limit +
done flag), `kanban_tasks` (priority, due date, labels, fractional position),
`kanban_task_assignees`, `kanban_comments`, `kanban_activity` (audit trail).

Created by MCP migrations `kanban_module_schema` / `kanban_module_seed`;
adopted into Zeus by `supabase/migrations/039_kanban_module.sql` (profile link
+ RLS retier). RLS follows the migration-026 pattern: Class O — `is_staff_up()`
SELECT for authenticated, no client write policies; the app reads and writes
through the service-role client.

Seed data: 8 department boards (Sales, Tech, Purchasing, Warehouse, Finance,
Marketing, Customer Service, HR), 16 fictional directory people covering all
14 job roles (emails `@demo.medshipops.com`), one personal board each, and a
handful of realistic tasks.

## UI

- `src/app/dashboard/kanban/` — boards home + board view (server components)
- `src/components/kanban/` — client components: dnd-kit drag & drop with drag
  overlay and spring drop animation, motion entrance/exit transitions, task
  drawer (status, priority, due date, description, assignees, comments,
  activity feed), WIP-limit badges, per-member filtering
- Styled with the standard semantic tokens (`bg-card`, `border-border`,
  `text-muted-foreground`, `medship-*` brand colors) — light and dark themes.
