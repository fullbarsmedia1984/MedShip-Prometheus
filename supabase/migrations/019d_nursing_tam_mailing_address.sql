-- Reconciled from live DB (Phase 0, PRD §12): applied 2026-06-26 as version
-- 20260626114443 "nursing_tam_mailing_address" via MCP apply_migration,
-- but never committed to the repo. Recorded verbatim for repo/schema parity.
-- Do NOT re-apply to the production project.

set search_path to nursing_tam, public;
alter table nursing_tam.institutions
  add column if not exists nursing_dept_name text,
  add column if not exists mail_street      text,
  add column if not exists mail_suite       text,
  add column if not exists mail_city        text,
  add column if not exists mail_state       char(2),
  add column if not exists mail_zip         text,
  add column if not exists mail_source_url  text;
