import { Logger, ServiceUnavailableException } from '@nestjs/common'

/** Tunables for Gemini retry with exponential backoff. */
export interface GeminiRetryOptions {
  /** Total attempts including the first try. Defaults to 4 (1 try + 3 retries). */
  maxAttempts?: number
  /** Delay before the first retry. Doubles on every attempt. Defaults to 1000ms. */
  initialDelayMs?: number
  /** Cap for the backoff delay. Defaults to 15000ms. */
  maxDelayMs?: number
  /** Label used in log lines, e.g. "Gemini chat" or "Gemini embeddings". */
  operation?: string
}

const DEFAULT_MAX_ATTEMPTS = 4
const DEFAULT_INITIAL_DELAY_MS = 1000
const DEFAULT_MAX_DELAY_MS = 15000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * True when a Gemini SDK error looks transient and is worth retrying:
 *  - 429 / RESOURCE_EXHAUSTED (rate limit / quota burst)
 *  - 503 / UNAVAILABLE (model overloaded - "high demand, try again later")
 *  - 500 / INTERNAL (occasional transient backend hiccup)
 */
export function isRetryableGeminiError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const err = error as Record<string, unknown>

  const status =
    typeof err.status === 'number'
      ? err.status
      : typeof (err.error as Record<string, unknown> | undefined)?.code === 'number'
        ? ((err.error as Record<string, unknown>).code as number)
        : undefined
  if (status === 429 || status === 503 || status === 500) return true

  const code = typeof err.code === 'number' ? err.code : undefined
  if (code === 429 || code === 503 || code === 500) return true

  const parts: string[] = []
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0) parts.push(value)
  }
  push(err.status as unknown)
  push(err.code as unknown)
  push(err.message as unknown)
  const nested = err.error as Record<string, unknown> | undefined
  if (nested && typeof nested === 'object') {
    push(nested.status as unknown)
    push(nested.code as unknown)
    push(nested.message as unknown)
  }
  const haystack = parts.join(' ').toLowerCase()
  return (
    haystack.includes('resource_exhausted') ||
    haystack.includes('unavailable') ||
    haystack.includes('overloaded') ||
    haystack.includes('high demand') ||
    haystack.includes('try again later') ||
    haystack.includes('rate limit') ||
    haystack.includes('quota') ||
    haystack.includes('429') ||
    haystack.includes('503')
  )
}

/**
 * Run a Gemini SDK call with jittered exponential backoff on transient
 * 429 / 503 errors. After the attempts are exhausted the *original* error
 * is rethrown so callers can map it to a user-friendly response.
 */
export async function withGeminiRetry<T>(
  fn: () => Promise<T>,
  options: GeminiRetryOptions = {},
  logger?: Logger,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const operation = options.operation ?? 'Gemini request'

  let attempt = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1
    try {
      return await fn()
    } catch (error) {
      const retryable = isRetryableGeminiError(error)
      if (!retryable || attempt >= maxAttempts) throw error
      const exponential = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs)
      const jitter = Math.floor(Math.random() * 500)
      const delay = exponential + jitter
      logger?.warn(
        `${operation} hit a transient error (attempt ${attempt}/${maxAttempts}) - ` +
          `retrying in ${delay}ms: ${(error as Error)?.message ?? error}`,
      )
      await sleep(delay)
    }
  }
}

/**
 * Map a (possibly retried) Gemini SDK failure to a clean Nest HTTP error so
 * the frontend sees "model is busy, please retry" instead of a raw 500 +
 * stack trace. Non-transient errors are rethrown untouched.
 */
export function toFriendlyGeminiError(error: unknown, operation: string): never {
  if (isRetryableGeminiError(error)) {
    throw new ServiceUnavailableException(
      'The AI model is currently experiencing high demand. Please wait a moment and try again.',
    )
  }
  // eslint-disable-next-line no-console
  console.error(`${operation} failed (non-retryable):`, error)
  throw error
}
