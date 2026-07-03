import type {
  TamContactListParams,
  TamContactRole,
  TamControlType,
  TamInstitutionFilters,
  TamInstitutionListParams,
  TamInstitutionSortKey,
  TamProgramTier,
  TamScenario,
  TamSortDirection,
} from '@/lib/tam/supabase'

const TIERS = new Set<TamProgramTier>([
  'cna',
  'lpn',
  'adn',
  'diploma',
  'bsn',
  'graduate',
])

const CONTACT_ROLES = new Set<TamContactRole>([
  'dean',
  'lab_sim',
  'program_director',
  'other',
])

const CONTROL_TYPES = new Set<TamControlType>([
  'public',
  'private_nonprofit',
  'private_forprofit',
  'unknown',
])

const SORT_KEYS = new Set<TamInstitutionSortKey>([
  'name',
  'state',
  'city',
  'control',
  'unitid',
])

export function parseTamScenario(value: string | null): TamScenario {
  if (value === 'low' || value === 'high' || value === 'base') return value
  return 'base'
}

export function parseInstitutionListParams(
  searchParams: URLSearchParams
): TamInstitutionListParams {
  const sortBy = searchParams.get('sortBy')
  const sortDirection = searchParams.get('sortDirection')

  return {
    ...parseInstitutionFilters(searchParams),
    page: parsePositiveInt(searchParams.get('page'), 1),
    pageSize: parsePositiveInt(searchParams.get('pageSize'), 25),
    sortBy: sortBy && SORT_KEYS.has(sortBy as TamInstitutionSortKey)
      ? (sortBy as TamInstitutionSortKey)
      : 'name',
    sortDirection: sortDirection === 'desc' ? 'desc' : 'asc',
  }
}

export function parseInstitutionFilters(
  searchParams: URLSearchParams
): TamInstitutionFilters {
  return {
    search: searchParams.get('search')?.trim() || undefined,
    states: parseStringList(searchParams, 'state').map((state) =>
      state.toUpperCase()
    ),
    tiers: parseEnumList(searchParams, 'tier', TIERS),
    control: parseEnumList(searchParams, 'control', CONTROL_TYPES),
    contactRoles: parseEnumList(searchParams, 'contactRole', CONTACT_ROLES),
    contactHasEmail: parseBoolean(searchParams.get('contactHasEmail')),
    geocodedOnly: parseBoolean(searchParams.get('geocodedOnly')),
  }
}

export function parseContactListParams(
  searchParams: URLSearchParams
): TamContactListParams {
  return {
    ...parseInstitutionFilters(searchParams),
    roles: parseEnumList(searchParams, 'contactRole', CONTACT_ROLES),
    page: parsePositiveInt(searchParams.get('page'), 1),
    pageSize: parsePositiveInt(searchParams.get('pageSize'), 25),
  }
}

export function parseSortDirection(value: string | null): TamSortDirection {
  return value === 'desc' ? 'desc' : 'asc'
}

export function csvEscape(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (!/[",\r\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

function parseStringList(searchParams: URLSearchParams, key: string) {
  return searchParams
    .getAll(key)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
}

function parseEnumList<T extends string>(
  searchParams: URLSearchParams,
  key: string,
  allowed: Set<T>
) {
  return parseStringList(searchParams, key).filter((value): value is T =>
    allowed.has(value as T)
  )
}

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseBoolean(value: string | null) {
  return value === '1' || value === 'true' || value === 'yes'
}
