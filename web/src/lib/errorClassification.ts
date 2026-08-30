/**
 * @module lib/errorClassification
 * Central classifier for API, transport, authentication, capability, and
 * transient-wait failures. Shared error components use this taxonomy so
 * recovery guidance remains consistent across the application.
 */

import {
  isApiError,
  isRateLimitError,
  isUpstreamUnavailableError,
} from './resilience'

export type ErrorKind =
  | 'waiting'
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'timed_out'
  | 'unsupported'
  | 'unavailable'
  | 'server'
  | 'request'
  | 'offline'
  | 'network'

/**
 * Returns true when the error is a recoverable wait — the user does
 * NOT need to take action, the system just needs to back off until the
 * upstream cooldown elapses. Used by {@link QueryError} to swap the
 * loud error UI for a quiet placeholder while the global banner shows
 * the countdown.
 */
export function isTransientWaiting(err: unknown): boolean {
  return isRateLimitError(err) || isUpstreamUnavailableError(err)
}

/**
 * Maps transport and API failures onto user-facing recovery states.
 *
 * HTTP status wins over browser connectivity so a permanent 403 or 500 does
 * not suddenly masquerade as an offline failure when the network changes.
 */
export function classifyError(err: unknown, online: boolean): ErrorKind {
  if (err == null) return 'waiting'
  if (isTransientWaiting(err)) return 'waiting'

  const status = isApiError(err) ? err.status : undefined
  const code = isApiError(err) ? err.code?.toUpperCase() : undefined

  if (status === 404) return 'not_found'
  if (status === 401) return 'unauthorized'
  if (status === 403 || code === 'PERMISSION_DENIED' || code === 'FORBIDDEN') {
    return 'forbidden'
  }
  if (
    status === 408 ||
    status === 504 ||
    (err instanceof Error &&
      (err.name === 'TimeoutError' || /timed?\s*out|timeout/i.test(err.message)))
  ) {
    return 'timed_out'
  }
  if (
    status === 405 ||
    status === 501 ||
    code === 'AUTH_MODE_OPEN' ||
    code === 'NOT_IMPLEMENTED' ||
    code === 'UNSUPPORTED'
  ) {
    return 'unsupported'
  }
  if (
    status === 502 ||
    status === 503 ||
    code === 'DEPENDENCY_UNAVAILABLE' ||
    code === 'SERVICE_UNAVAILABLE'
  ) {
    return 'unavailable'
  }
  if (status !== undefined && status >= 500) return 'server'
  if (status === 0) return 'offline'
  if (status !== undefined) return 'request'
  return online ? 'network' : 'offline'
}
