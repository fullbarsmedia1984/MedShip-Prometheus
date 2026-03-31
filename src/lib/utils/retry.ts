/**
 * Exponential backoff retry logic
 */

export interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  retryOn?: (error: unknown) => boolean
}

const defaultOptions: Required<RetryOptions> = {
  maxRetries: 4,
  initialDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  retryOn: () => true,
}

/**
 * Calculate delay for a given retry attempt using exponential backoff with jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  options: Pick<Required<RetryOptions>, 'initialDelayMs' | 'maxDelayMs' | 'backoffMultiplier'>
): number {
  const { initialDelayMs, maxDelayMs, backoffMultiplier } = options

  // Exponential backoff
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt)

  // Add jitter (0-25% of delay)
  const jitter = exponentialDelay * Math.random() * 0.25

  // Cap at max delay
  return Math.min(exponentialDelay + jitter, maxDelayMs)
}

/**
 * Get the next retry timestamp
 */
export function getNextRetryTime(
  retryCount: number,
  options?: Partial<RetryOptions>
): Date {
  const opts = { ...defaultOptions, ...options }
  const delayMs = calculateBackoffDelay(retryCount, opts)
  return new Date(Date.now() + delayMs)
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Execute a function with exponential backoff retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...defaultOptions, ...options }
  let lastError: unknown

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Check if we should retry this error
      if (!opts.retryOn(error)) {
        throw error
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= opts.maxRetries) {
        break
      }

      // Calculate delay and wait
      const delay = calculateBackoffDelay(attempt, opts)
      console.log(
        `Retry attempt ${attempt + 1}/${opts.maxRetries} after ${delay}ms`
      )
      await sleep(delay)
    }
  }

  throw lastError
}

/**
 * Check if an error is retryable (network errors, rate limits, etc.)
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    // Network errors
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused')
    ) {
      return true
    }

    // Rate limiting
    if (
      message.includes('rate limit') ||
      message.includes('too many requests') ||
      message.includes('429')
    ) {
      return true
    }

    // Temporary server errors
    if (
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504')
    ) {
      return true
    }
  }

  return false
}

/**
 * Create retry options for API calls
 */
export function apiRetryOptions(): RetryOptions {
  return {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    retryOn: isRetryableError,
  }
}
