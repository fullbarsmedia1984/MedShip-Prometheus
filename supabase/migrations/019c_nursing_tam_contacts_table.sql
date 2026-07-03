-- Reconciled from live DB (Phase 0, PRD §12): applied 2026-06-26 as version
-- 20260626031844 "nursing_tam_contacts_table" via MCP apply_migration,
-- but never committed to the repo. Recorded verbatim for repo/schema parity.
-- Do NOT re-apply to the production project.
-- NOTE: contains PII (contact names/emails/phones); RLS disabled — see PRD §8.6.

set search_path to nursing_tam, public;
create table if not exists contacts (
  id              uuid primary key default gen_random_uuid(),
  institution_id  uuid not null references institutions(id) on delete cascade,
  name            text not null,
  title           text,
  email           text,
  phone           text,
  role_category   text not null check (role_category in ('dean','lab_sim','program_director','other')),
  source          source_type,
  source_url      text,
  confidence      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_contacts_inst on contacts(institution_id);
create unique index if not exists uq_contacts_inst_email on contacts(institution_id, lower(email)) where email is not null;
create or replace view v_primary_contact as
select distinct on (c.institution_id)
  c.institution_id, c.name, c.title, c.email, c.phone, c.role_category, c.confidence, c.source_url
from contacts c
order by c.institution_id,
  case c.role_category when 'dean' then 1 when 'lab_sim' then 2 when 'program_director' then 3 else 4 end,
  case c.confidence when 'high' then 0 when 'medium' then 1 else 2 end,
  (c.email is not null) desc;
