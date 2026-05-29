/**
 * @module lib/errorClassification
 * Central classifier for "transient waiting"
 * errors (rate-limited, upstream-breaker-open). Pages and shared error
 * components consult this helper to decide whether to render the calm
 * "we're waiting it out" placeholder rather than a generic angry
 * "request failed" panel — the global <RateLimitBanner> already conveys
 * the state, so per-page noise would just compete with it.
 */

import {
  isRateLimitError,
  isUpstreamUnavailableError,
} from './resilience'

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
