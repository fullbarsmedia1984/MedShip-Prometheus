-- Reconciled from live DB (Phase 0, PRD §12): applied 2026-06-25 as version
-- 20260625215052 "nursing_tam_enrichment_columns" via MCP apply_migration,
-- but never committed to the repo. Recorded verbatim for repo/schema parity.
-- Do NOT re-apply to the production project.

set search_path to nursing_tam, public;
alter table nursing_tam.institutions
  add column if not exists nursing_contact_name  text,
  add column if not exists nursing_contact_title text,
  add column if not exists nursing_contact_email text,
  add column if not exists nursing_contact_phone text;
alter table nursing_tam.programs
  add column if not exists accreditors text[] not null default '{}';
