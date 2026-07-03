-- Reconciled from live DB (Phase 0, PRD §12): applied 2026-06-25 as version
-- 20260625194141 "nursing_tam_initial_schema" via MCP apply_migration,
-- but never committed to the repo. Recorded verbatim for repo/schema parity.
-- Do NOT re-apply to the production project.
-- NOTE: this schema's tables have RLS disabled; safe only while nursing_tam
-- is not in PostgREST's exposed schemas. See PRD §8.6.

create schema if not exists nursing_tam;
set search_path to nursing_tam, public;

do $$ begin
  create type program_tier as enum ('cna','lpn','adn','diploma','bsn','graduate');
exception when duplicate_object then null; end $$;

do $$ begin
  create type accreditor_type as enum ('ccne','acen','nln_cnea','none');
exception when duplicate_object then null; end $$;

do $$ begin
  create type control_type as enum ('public','private_nonprofit','private_forprofit','unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type delivery_mode as enum ('campus','online','hybrid','unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type source_type as enum (
    'ipeds','scorecard','ccne','acen','nln_cnea',
    'registerednursing','nursingprocess','state_board','cna_registry','google_places');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tam_scenario as enum ('low','base','high');
exception when duplicate_object then null; end $$;

create table if not exists nursing_tam.institutions (
  id              uuid primary key default gen_random_uuid(),
  unitid          bigint unique,
  name            text not null,
  aka_names       text[] not null default '{}',
  street          text,
  city            text,
  state           char(2),
  zip             text,
  lat             double precision,
  lng             double precision,
  phone           text,
  website         text,
  control         nursing_tam.control_type not null default 'unknown',
  parent_unitid   bigint,
  is_branch_campus boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_institutions_state on nursing_tam.institutions (state);
create index if not exists idx_institutions_name  on nursing_tam.institutions (lower(name));

create table if not exists nursing_tam.programs (
  id                    uuid primary key default gen_random_uuid(),
  institution_id        uuid not null references nursing_tam.institutions(id) on delete cascade,
  tier                  nursing_tam.program_tier not null,
  cip_code              text,
  award_level           text,
  accreditor            nursing_tam.accreditor_type not null default 'none',
  state_board_approved  boolean,
  annual_completions    integer,
  est_annual_enrollment integer,
  nclex_pass_rate       numeric(5,2),
  delivery_mode         nursing_tam.delivery_mode not null default 'unknown',
  source_ids            uuid[] not null default '{}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (institution_id, tier, cip_code, award_level)
);
create index if not exists idx_programs_tier on nursing_tam.programs (tier);
create index if not exists idx_programs_institution on nursing_tam.programs (institution_id);

create table if not exists nursing_tam.source_records (
  id                     uuid primary key default gen_random_uuid(),
  source                 nursing_tam.source_type not null,
  natural_key            text not null,
  raw                    jsonb not null,
  matched_institution_id uuid references nursing_tam.institutions(id) on delete set null,
  fetched_at             timestamptz not null default now(),
  unique (source, natural_key)
);
create index if not exists idx_source_records_match on nursing_tam.source_records (matched_institution_id);
create index if not exists idx_source_records_source on nursing_tam.source_records (source);

create table if not exists nursing_tam.tam_assumptions (
  tier                            nursing_tam.program_tier not null,
  scenario                        nursing_tam.tam_scenario not null,
  students_per_program_per_year   numeric not null,
  consumable_spend_per_student    numeric not null,
  durable_equipment_spend_per_program numeric not null,
  amortization_years              numeric not null default 5,
  notes                           text,
  primary key (tier, scenario)
);

create or replace view nursing_tam.v_institution_full as
select i.*,
       (select count(*) from nursing_tam.programs p where p.institution_id = i.id) as n_programs,
       (select array_agg(distinct p.tier::text order by p.tier::text)
          from nursing_tam.programs p where p.institution_id = i.id) as tiers
from nursing_tam.institutions i;

create or replace view nursing_tam.v_tam_by_tier as
with prog as (
  select tier,
         count(*)                   as n_programs,
         sum(est_annual_enrollment) as enrollment_data
  from nursing_tam.programs
  group by tier
)
select a.tier,
       a.scenario,
       p.n_programs,
       coalesce(p.enrollment_data, p.n_programs * a.students_per_program_per_year) as effective_students,
       coalesce(p.enrollment_data, p.n_programs * a.students_per_program_per_year)
         * a.consumable_spend_per_student            as consumable_tam,
       p.n_programs * a.durable_equipment_spend_per_program / nullif(a.amortization_years,0) as equipment_tam,
       coalesce(p.enrollment_data, p.n_programs * a.students_per_program_per_year)
         * a.consumable_spend_per_student
       + p.n_programs * a.durable_equipment_spend_per_program / nullif(a.amortization_years,0) as total_tam
from nursing_tam.tam_assumptions a
join prog p on p.tier = a.tier;

create or replace view nursing_tam.v_tam_summary as
select scenario,
       sum(n_programs)     as n_programs,
       sum(consumable_tam) as consumable_tam,
       sum(equipment_tam)  as equipment_tam,
       sum(total_tam)      as total_tam
from nursing_tam.v_tam_by_tier
group by scenario;

create or replace view nursing_tam.v_tam_by_state as
select i.state,
       p.tier,
       count(*) as n_programs,
       sum(coalesce(p.est_annual_enrollment, 0)) as enrollment_data
from nursing_tam.programs p
join nursing_tam.institutions i on i.id = p.institution_id
group by i.state, p.tier;

create or replace view nursing_tam.v_coverage_report as
select 'institutions_total' as metric, count(*)::text as value from nursing_tam.institutions
union all
select 'institutions_with_phone',   count(*)::text from nursing_tam.institutions where phone is not null
union all
select 'institutions_with_website', count(*)::text from nursing_tam.institutions where website is not null
union all
select 'institutions_with_geo',     count(*)::text from nursing_tam.institutions where lat is not null
union all
select 'programs_total',            count(*)::text from nursing_tam.programs
union all
select 'programs_with_enrollment',  count(*)::text from nursing_tam.programs where est_annual_enrollment is not null;
