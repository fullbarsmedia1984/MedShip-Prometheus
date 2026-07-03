import type { JsonObject } from './types'

export const DEFAULT_HERCULES_API_BASE_URL = 'https://hercules-dev.medicalshipment.com'

export type HerculesRateLimit = {
  limit: number | null
  remaining: number | null
  reset: string | null
}

export type HerculesApiRequestBody = {
  limit?: number
  offset?: number
  sortBy?: string
  sortOrder?: 'ASC' | 'DESC'
  search?: string
  filters?: Array<{
    field: string
    operator:
      | 'eq'
      | 'ne'
      | 'gt'
      | 'gte'
      | 'lt'
      | 'lte'
      | 'in'
      | 'contains'
      | 'starts'
      | 'ends'
      | 'exists'
    value?: unknown
    caseSensitive?: boolean
  }>
  fields?: string[]
}

export type HerculesEgressPage<T> = {
  data: T[]
  metadata: {
    total: number
    limit: number
    offset: number
    currentPage: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
    count: number
  }
}

type HerculesEnvelope<T> = {
  statusCode: number
  message: string
  data: T | null
  error: unknown
  timestamp: string
  path: string
}

export class HerculesApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly path: string | null,
    readonly rateLimit: HerculesRateLimit
  ) {
    super(message)
    this.name = 'HerculesApiError'
  }
}

export class HerculesBadRequestError extends HerculesApiError {
  override name = 'HerculesBadRequestError'
}

export class HerculesUnauthorizedError extends HerculesApiError {
  override name = 'HerculesUnauthorizedError'
}

export class HerculesForbiddenError extends HerculesApiError {
  override name = 'HerculesForbiddenError'
}

export class HerculesRateLimitExceededError extends HerculesForbiddenError {
  override name = 'HerculesRateLimitExceededError'
}

export class HerculesMissingEgressPermissionError extends HerculesForbiddenError {
  override name = 'HerculesMissingEgressPermissionError'
}

export class HerculesInvalidTokenError extends HerculesUnauthorizedError {
  override name = 'HerculesInvalidTokenError'
}

export class HerculesExpiredTokenError extends HerculesUnauthorizedError {
  override name = 'HerculesExpiredTokenError'
}

export class HerculesEnvelopeValidationError extends Error {
  override name = 'HerculesEnvelopeValidationError'
}

export class HerculesMissingCredentialsError extends Error {
  override name = 'HerculesMissingCredentialsError'
}

export type HerculesApiClientOptions = {
  baseUrl?: string
  appId: string
  accessToken: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function numberHeader(value: string | null) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function captureRateLimit(headers: Headers): HerculesRateLimit {
  return {
    limit: numberHeader(headers.get('X-RateLimit-Limit')),
    remaining: numberHeader(headers.get('X-RateLimit-Remaining')),
    reset: headers.get('X-RateLimit-Reset'),
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '')
}

function validateEnvelope<T>(value: unknown): HerculesEnvelope<T> {
  if (!isRecord(value)) {
    throw new HerculesEnvelopeValidationError('Hercules response envelope must be an object')
  }

  if (typeof value.statusCode !== 'number') {
    throw new HerculesEnvelopeValidationError('Hercules response envelope missing statusCode')
  }
  if (typeof value.message !== 'string') {
    throw new HerculesEnvelopeValidationError('Hercules response envelope missing message')
  }
  if (typeof value.timestamp !== 'string') {
    throw new HerculesEnvelopeValidationError('Hercules response envelope missing timestamp')
  }
  if (typeof value.path !== 'string') {
    throw new HerculesEnvelopeValidationError('Hercules response envelope missing path')
  }
  if (!('data' in value)) {
    throw new HerculesEnvelopeValidationError('Hercules response envelope missing data')
  }

  return value as HerculesEnvelope<T>
}

function validatePage<T>(value: unknown): HerculesEgressPage<T> {
  if (!isRecord(value)) {
    throw new HerculesEnvelopeValidationError('Hercules egress page data must be an object')
  }
  if (!Array.isArray(value.data)) {
    throw new HerculesEnvelopeValidationError('Hercules egress page missing data array')
  }
  if (!isRecord(value.metadata)) {
    throw new HerculesEnvelopeValidationError('Hercules egress page missing metadata')
  }

  return value as HerculesEgressPage<T>
}

function errorForEnvelope(envelope: HerculesEnvelope<unknown>, rateLimit: HerculesRateLimit) {
  const message = envelope.message
  const path = envelope.path

  if (envelope.statusCode === 400) {
    return new HerculesBadRequestError(message, envelope.statusCode, path, rateLimit)
  }
  if (envelope.statusCode === 401 && /expired/i.test(message)) {
    return new HerculesExpiredTokenError(message, envelope.statusCode, path, rateLimit)
  }
  if (envelope.statusCode === 401 && /invalid/i.test(message)) {
    return new HerculesInvalidTokenError(message, envelope.statusCode, path, rateLimit)
  }
  if (envelope.statusCode === 401) {
    return new HerculesUnauthorizedError(message, envelope.statusCode, path, rateLimit)
  }
  if (envelope.statusCode === 403 && /rate limit exceeded/i.test(message)) {
    return new HerculesRateLimitExceededError(message, envelope.statusCode, path, rateLimit)
  }
  if (envelope.statusCode === 403 && /not authorized for data egress/i.test(message)) {
    return new HerculesMissingEgressPermissionError(
      message,
      envelope.statusCode,
      path,
      rateLimit
    )
  }
  if (envelope.statusCode === 403) {
    return new HerculesForbiddenError(message, envelope.statusCode, path, rateLimit)
  }

  return new HerculesApiError(message, envelope.statusCode, path, rateLimit)
}

export class HerculesApiClient {
  readonly baseUrl: string
  readonly appId: string
  readonly accessToken: string
  readonly timeoutMs: number
  readonly fetchImpl: typeof fetch
  lastRateLimit: HerculesRateLimit = {
    limit: null,
    remaining: null,
    reset: null,
  }

  constructor(options: HerculesApiClientOptions) {
    if (!options.appId?.trim()) {
      throw new HerculesMissingCredentialsError('HERCULES_API_APP_ID is required')
    }
    if (!options.accessToken?.trim()) {
      throw new HerculesMissingCredentialsError('HERCULES_API_ACCESS_TOKEN is required')
    }

    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_HERCULES_API_BASE_URL)
    this.appId = options.appId
    this.accessToken = options.accessToken
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async listParts<T = JsonObject>(body: HerculesApiRequestBody) {
    return this.postEgressPage<T>('/api/v1/parts/list', body)
  }

  private async postEgressPage<T>(path: string, body: HerculesApiRequestBody) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'X-App-Id': this.appId,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      const rateLimit = captureRateLimit(response.headers)
      if (rateLimit.limit !== null || rateLimit.remaining !== null || rateLimit.reset !== null) {
        this.lastRateLimit = rateLimit
      }

      const envelope = validateEnvelope<HerculesEgressPage<T>>(await response.json())
      if (!response.ok || envelope.statusCode >= 400) {
        throw errorForEnvelope(envelope, rateLimit)
      }
      if (envelope.data === null) {
        throw new HerculesEnvelopeValidationError('Hercules success envelope had null data')
      }

      return {
        envelope,
        page: validatePage<T>(envelope.data),
        rateLimit,
      }
    } finally {
      clearTimeout(timeout)
    }
  }
}
