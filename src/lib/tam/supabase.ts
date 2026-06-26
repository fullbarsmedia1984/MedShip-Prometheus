import 'server-only'

import { Pool, type QueryResultRow } from 'pg'

const TAM_SCHEMA = 'nursing_tam'

export type TamScenario = 'low' | 'base' | 'high'
export type TamProgramTier =
  | 'cna'
  | 'lpn'
  | 'adn'
  | 'diploma'
  | 'bsn'
  | 'graduate'
export type TamControlType =
  | 'public'
  | 'private_nonprofit'
  | 'private_forprofit'
  | 'unknown'
export type TamDeliveryMode = 'campus' | 'online' | 'hybrid' | 'unknown'
export type TamContactRole = 'dean' | 'lab_sim' | 'program_director' | 'other'

export type TamSummaryRow = {
  scenario: TamScenario
  n_programs: string
  consumable_tam: string
  equipment_tam: string
  total_tam: string
}

export type TamByTierRow = {
  tier: TamProgramTier
  scenario: TamScenario
  n_programs: string
  effective_students: string
  consumable_tam: string
  equipment_tam: string
  total_tam: string
}

export type TamByStateRow = {
  state: string
  tier: TamProgramTier
  n_programs: string
  enrollment_data: string
}

export type TamByStateDollarsRow = {
  state: string
  scenario: TamScenario
  n_programs: string
  effective_students: string
  total_tam: string
}

export type TamPrimaryContactRow = {
  institution_id: string
  name: string
  title: string | null
  email: string | null
  phone: string | null
  role_category: TamContactRole
  confidence: string | null
  source_url: string | null
}

export type TamInstitutionRow = {
  id: string
  unitid: string | null
  name: string
  aka_names: string[]
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  lat: number | null
  lng: number | null
  phone: string | null
  website: string | null
  control: TamControlType
  parent_unitid: string | null
  is_branch_campus: boolean
  nursing_contact_name: string | null
  nursing_contact_title: string | null
  nursing_contact_email: string | null
  nursing_contact_phone: string | null
  contact_source_url: string | null
  contact_confidence: string | null
  nursing_dept_name: string | null
  mail_street: string | null
  mail_suite: string | null
  mail_city: string | null
  mail_state: string | null
  mail_zip: string | null
  mail_source_url: string | null
}

export type TamProgramRow = {
  id: string
  institution_id: string
  tier: TamProgramTier
  cip_code: string | null
  award_level: string | null
  accreditor: 'ccne' | 'acen' | 'nln_cnea' | 'none'
  state_board_approved: boolean | null
  annual_completions: number | null
  est_annual_enrollment: number | null
  nclex_pass_rate: string | null
  delivery_mode: TamDeliveryMode
  source_ids: string[]
  accreditors: string[]
}

export type TamContactRow = {
  id: string
  institution_id: string
  name: string
  title: string | null
  email: string | null
  phone: string | null
  role_category: TamContactRole
  source: string | null
  source_url: string | null
  confidence: string | null
}

export type TamSortDirection = 'asc' | 'desc'

export type TamInstitutionSortKey =
  | 'name'
  | 'state'
  | 'city'
  | 'control'
  | 'unitid'

export type TamInstitutionFilters = {
  search?: string
  states?: string[]
  tiers?: TamProgramTier[]
  control?: TamControlType[]
  contactRoles?: TamContactRole[]
  contactHasEmail?: boolean
  geocodedOnly?: boolean
}

export type TamPagination = {
  page?: number
  pageSize?: number
}

export type TamInstitutionListParams = TamInstitutionFilters &
  TamPagination & {
    sortBy?: TamInstitutionSortKey
    sortDirection?: TamSortDirection
  }

export type TamInstitutionListRow = Pick<
  TamInstitutionRow,
  | 'id'
  | 'unitid'
  | 'name'
  | 'city'
  | 'state'
  | 'lat'
  | 'lng'
  | 'control'
  | 'nursing_dept_name'
  | 'mail_city'
  | 'mail_state'
> & {
  programs: Pick<
    TamProgramRow,
    'id' | 'tier' | 'annual_completions' | 'est_annual_enrollment'
  >[]
  contacts: Pick<
    TamContactRow,
    'id' | 'name' | 'title' | 'email' | 'phone' | 'role_category'
  >[]
}

export type TamGeoRow = Pick<
  TamInstitutionListRow,
  'id' | 'name' | 'city' | 'state' | 'lat' | 'lng' | 'programs' | 'contacts'
>

export type TamContactListParams = TamInstitutionFilters &
  TamPagination & {
    roles?: TamContactRole[]
  }

export type TamMailingContactRow = Pick<
  TamContactRow,
  'id' | 'name' | 'title' | 'email' | 'phone' | 'role_category'
> & {
  institution: Pick<
    TamInstitutionRow,
    | 'id'
    | 'name'
    | 'nursing_dept_name'
    | 'mail_street'
    | 'mail_suite'
    | 'mail_city'
    | 'mail_state'
    | 'mail_zip'
  >
}

type TamInstitutionDetail = TamInstitutionRow & {
  programs: TamProgramRow[]
  contacts: TamContactRow[]
}

type SqlValue = string | number | boolean | string[] | null

type SqlBuilder = {
  values: SqlValue[]
  param: (value: SqlValue) => string
}

let pool: Pool | null = null

function getTamPool() {
  const databaseUrl =
    process.env.DATABASE_URL || process.env.DB_URL || process.env.DG_URL

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL, DB_URL, or DG_URL is required for TAM Postgres queries.'
    )
  }

  pool ??= new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('sslmode=disable')
      ? false
      : { rejectUnauthorized: false },
    max: 5,
  })

  return pool
}

async function tamQuery<T extends QueryResultRow>(
  text: string,
  values: SqlValue[] = []
) {
  return getTamPool().query<T>(text, values)
}

export async function getTamSummary(): Promise<TamSummaryRow[]> {
  const { rows } = await tamQuery<TamSummaryRow>(`
    select scenario, n_programs, consumable_tam, equipment_tam, total_tam
    from ${TAM_SCHEMA}.v_tam_summary
    order by scenario
  `)

  return rows
}

export async function getTamByTier(
  scenario: TamScenario = 'base'
): Promise<TamByTierRow[]> {
  const { rows } = await tamQuery<TamByTierRow>(
    `
      select
        tier,
        scenario,
        n_programs,
        effective_students,
        consumable_tam,
        equipment_tam,
        total_tam
      from ${TAM_SCHEMA}.v_tam_by_tier
      where scenario = $1
      order by tier
    `,
    [scenario]
  )

  return rows
}

export async function getTamByState(): Promise<TamByStateRow[]> {
  const { rows } = await tamQuery<TamByStateRow>(`
    select state, tier, n_programs, enrollment_data
    from ${TAM_SCHEMA}.v_tam_by_state
    order by state, tier
  `)

  return rows
}

export async function getTamByStateDollars(
  scenario: TamScenario = 'base'
): Promise<TamByStateDollarsRow[]> {
  const { rows } = await tamQuery<TamByStateDollarsRow>(
    `
      select state, scenario, n_programs, effective_students, total_tam
      from ${TAM_SCHEMA}.v_tam_by_state_dollars
      where scenario = $1
      order by state
    `,
    [scenario]
  )

  return rows
}

export async function getTamOverview(scenario: TamScenario = 'base') {
  const [summary, byTier, byState, byStateDollars] = await Promise.all([
    getTamSummary(),
    getTamByTier(scenario),
    getTamByState(),
    getTamByStateDollars(scenario),
  ])

  return {
    scenario,
    summary,
    selectedSummary:
      summary.find((row) => row.scenario === scenario) ?? summary[0] ?? null,
    byTier,
    byState,
    byStateDollars,
  }
}

export async function listTamInstitutions(
  params: TamInstitutionListParams = {}
) {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = clampPageSize(params.pageSize)
  const offset = (page - 1) * pageSize
  const sortBy = params.sortBy ?? 'name'
  const sortDirection = params.sortDirection ?? 'asc'
  const builder = createSqlBuilder()
  const whereSql = buildInstitutionWhere(params, builder)
  const countValues = [...builder.values]
  const orderSql = institutionOrderSql(sortBy, sortDirection)
  const tierSql = programFilterSql(params, builder)
  const contactSql = contactFilterSql(params, builder)

  const countPromise = tamQuery<{ total: string }>(
    `
      select count(*)::text as total
      from ${TAM_SCHEMA}.institutions i
      ${whereSql}
    `,
    countValues
  )

  const pageLimit = builder.param(pageSize)
  const pageOffset = builder.param(offset)
  const dataPromise = tamQuery<TamInstitutionListRow>(
    `
      select
        i.id,
        i.unitid,
        i.name,
        i.city,
        i.state,
        i.lat,
        i.lng,
        i.control,
        i.nursing_dept_name,
        i.mail_city,
        i.mail_state,
        coalesce((
          select json_agg(json_build_object(
            'id', p.id,
            'tier', p.tier,
            'annual_completions', p.annual_completions,
            'est_annual_enrollment', p.est_annual_enrollment
          ) order by p.tier)
          from ${TAM_SCHEMA}.programs p
          where p.institution_id = i.id
          ${tierSql}
        ), '[]'::json) as programs,
        coalesce((
          select json_agg(json_build_object(
            'id', c.id,
            'name', c.name,
            'title', c.title,
            'email', c.email,
            'phone', c.phone,
            'role_category', c.role_category
          ) order by c.role_category, c.name)
          from ${TAM_SCHEMA}.contacts c
          where c.institution_id = i.id
          ${contactSql}
        ), '[]'::json) as contacts
      from ${TAM_SCHEMA}.institutions i
      ${whereSql}
      ${orderSql}
      limit ${pageLimit}
      offset ${pageOffset}
    `,
    builder.values
  )

  const [countResult, dataResult] = await Promise.all([countPromise, dataPromise])

  return {
    data: dataResult.rows,
    totalItems: Number(countResult.rows[0]?.total ?? 0),
    page,
    pageSize,
  }
}

export async function getTamInstitution(
  institutionId: string
): Promise<TamInstitutionDetail | null> {
  const { rows } = await tamQuery<TamInstitutionDetail>(
    `
      select
        i.*,
        coalesce((
          select json_agg(p order by p.tier)
          from ${TAM_SCHEMA}.programs p
          where p.institution_id = i.id
        ), '[]'::json) as programs,
        coalesce((
          select json_agg(c order by c.role_category, c.name)
          from ${TAM_SCHEMA}.contacts c
          where c.institution_id = i.id
        ), '[]'::json) as contacts
      from ${TAM_SCHEMA}.institutions i
      where i.id = $1
      limit 1
    `,
    [institutionId]
  )

  return rows[0] ?? null
}

export async function listTamGeo(params: TamInstitutionFilters = {}) {
  const builder = createSqlBuilder()
  const whereSql = buildInstitutionWhere(
    { ...params, geocodedOnly: true },
    builder
  )
  const tierSql = programFilterSql(params, builder)
  const contactSql = contactFilterSql(params, builder)

  const { rows } = await tamQuery<TamGeoRow>(
    `
      select
        i.id,
        i.name,
        i.city,
        i.state,
        i.lat,
        i.lng,
        coalesce((
          select json_agg(json_build_object(
            'id', p.id,
            'tier', p.tier,
            'annual_completions', p.annual_completions,
            'est_annual_enrollment', p.est_annual_enrollment
          ) order by p.tier)
          from ${TAM_SCHEMA}.programs p
          where p.institution_id = i.id
          ${tierSql}
        ), '[]'::json) as programs,
        coalesce((
          select json_agg(json_build_object(
            'id', c.id,
            'name', c.name,
            'title', c.title,
            'email', c.email,
            'phone', c.phone,
            'role_category', c.role_category
          ) order by c.role_category, c.name)
          from ${TAM_SCHEMA}.contacts c
          where c.institution_id = i.id
          ${contactSql}
        ), '[]'::json) as contacts
      from ${TAM_SCHEMA}.institutions i
      ${whereSql}
      order by i.state, i.name
    `,
    builder.values
  )

  return rows
}

export async function listTamContacts(params: TamContactListParams = {}) {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = clampPageSize(params.pageSize)
  const offset = (page - 1) * pageSize
  const builder = createSqlBuilder()
  const whereSql = buildContactWhere(params, builder)
  const countValues = [...builder.values]

  const countPromise = tamQuery<{ total: string }>(
    `
      select count(*)::text as total
      from ${TAM_SCHEMA}.contacts c
      join ${TAM_SCHEMA}.institutions i on i.id = c.institution_id
      ${whereSql}
    `,
    countValues
  )

  const pageLimit = builder.param(pageSize)
  const pageOffset = builder.param(offset)
  const dataPromise = tamQuery<TamMailingContactRow>(
    `
      select
        c.id,
        c.name,
        c.title,
        c.email,
        c.phone,
        c.role_category,
        json_build_object(
          'id', i.id,
          'name', i.name,
          'nursing_dept_name', i.nursing_dept_name,
          'mail_street', i.mail_street,
          'mail_suite', i.mail_suite,
          'mail_city', i.mail_city,
          'mail_state', i.mail_state,
          'mail_zip', i.mail_zip
        ) as institution
      from ${TAM_SCHEMA}.contacts c
      join ${TAM_SCHEMA}.institutions i on i.id = c.institution_id
      ${whereSql}
      order by c.role_category, i.name, c.name
      limit ${pageLimit}
      offset ${pageOffset}
    `,
    builder.values
  )

  const [countResult, dataResult] = await Promise.all([countPromise, dataPromise])

  return {
    data: dataResult.rows,
    totalItems: Number(countResult.rows[0]?.total ?? 0),
    page,
    pageSize,
  }
}

function buildInstitutionWhere(
  filters: TamInstitutionFilters,
  builder: SqlBuilder
) {
  const clauses: string[] = []

  if (filters.search?.trim()) {
    clauses.push(`i.name ilike ${builder.param(`%${filters.search.trim()}%`)}`)
  }
  if (filters.states?.length) {
    clauses.push(`i.state = any(${builder.param(normalizeStates(filters.states))})`)
  }
  if (filters.control?.length) {
    clauses.push(`i.control = any(${builder.param(filters.control)})`)
  }
  if (filters.tiers?.length) {
    clauses.push(`
      exists (
        select 1
        from ${TAM_SCHEMA}.programs p_filter
        where p_filter.institution_id = i.id
          and p_filter.tier = any(${builder.param(filters.tiers)})
      )
    `)
  }
  if (filters.contactRoles?.length || filters.contactHasEmail) {
    const roleClause = filters.contactRoles?.length
      ? `and c_filter.role_category = any(${builder.param(filters.contactRoles)})`
      : ''
    const emailClause = filters.contactHasEmail
      ? 'and c_filter.email is not null'
      : ''
    clauses.push(`
      exists (
        select 1
        from ${TAM_SCHEMA}.contacts c_filter
        where c_filter.institution_id = i.id
          ${roleClause}
          ${emailClause}
      )
    `)
  }
  if (filters.geocodedOnly) {
    clauses.push('i.lat is not null and i.lng is not null')
  }

  return clauses.length ? `where ${clauses.join(' and ')}` : ''
}

function buildContactWhere(filters: TamContactListParams, builder: SqlBuilder) {
  const clauses: string[] = []
  const roles = filters.roles ?? filters.contactRoles

  if (roles?.length) {
    clauses.push(`c.role_category = any(${builder.param(roles)})`)
  }
  if (filters.contactHasEmail) {
    clauses.push('c.email is not null')
  }
  if (filters.search?.trim()) {
    clauses.push(`i.name ilike ${builder.param(`%${filters.search.trim()}%`)}`)
  }
  if (filters.states?.length) {
    clauses.push(`i.state = any(${builder.param(normalizeStates(filters.states))})`)
  }
  if (filters.tiers?.length) {
    clauses.push(`
      exists (
        select 1
        from ${TAM_SCHEMA}.programs p_filter
        where p_filter.institution_id = i.id
          and p_filter.tier = any(${builder.param(filters.tiers)})
      )
    `)
  }

  return clauses.length ? `where ${clauses.join(' and ')}` : ''
}

function programFilterSql(filters: TamInstitutionFilters, builder: SqlBuilder) {
  return filters.tiers?.length
    ? `and p.tier = any(${builder.param(filters.tiers)})`
    : ''
}

function contactFilterSql(filters: TamInstitutionFilters, builder: SqlBuilder) {
  const clauses: string[] = []

  if (filters.contactRoles?.length) {
    clauses.push(`c.role_category = any(${builder.param(filters.contactRoles)})`)
  }
  if (filters.contactHasEmail) {
    clauses.push('c.email is not null')
  }

  return clauses.length ? `and ${clauses.join(' and ')}` : ''
}

function institutionOrderSql(
  sortBy: TamInstitutionSortKey,
  sortDirection: TamSortDirection
) {
  const sortColumns = {
    name: 'i.name',
    state: 'i.state',
    city: 'i.city',
    control: 'i.control',
    unitid: 'i.unitid',
  } satisfies Record<TamInstitutionSortKey, string>
  const direction = sortDirection === 'desc' ? 'desc' : 'asc'

  return `order by ${sortColumns[sortBy]} ${direction} nulls last, i.name asc`
}

function createSqlBuilder(): SqlBuilder {
  const values: SqlValue[] = []

  return {
    values,
    param(value) {
      values.push(value)
      return `$${values.length}`
    },
  }
}

function clampPageSize(pageSize = 25) {
  return Math.min(Math.max(pageSize, 1), 250)
}

function normalizeStates(states: string[]) {
  return states.map((state) => state.trim().toUpperCase()).filter(Boolean)
}
