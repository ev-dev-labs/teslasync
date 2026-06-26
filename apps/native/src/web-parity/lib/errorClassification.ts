/**
 * @module lib/errorClassification
 * Central classifier for "transient waiting" errors (rate-limited,
 * upstream-breaker-open) — React Native parity port of
 * `web/src/lib/errorClassification.ts`.
 *
 * Pages and shared error components consult this helper to decide whether to
 * render the calm "we're waiting it out" placeholder rather than a generic
 * angry "request failed" panel — the global RateLimitBanner already conveys
 * the state, so per-page noise would just compete with it.
 *
 * ## Native adaptation
 *
 * The web original imports `isRateLimitError` and `isUpstreamUnavailableError`
 * from `./resilience`. That sibling module has not been ported into the native
 * web-parity tree yet (the conversion loop reaches `lib/resilience.ts` after
 * this file alphabetically), so to keep this port self-contained and
 * typecheck-clean the two guards are inlined below. They are pure, DOM-free
 * duck-type predicates and the checks are reproduced verbatim from the web
 * source, so the runtime behaviour of {@link isTransientWaiting} is identical.
 *
 * The web guards additionally try `instanceof RateLimitError` /
 * `instanceof UpstreamUnavailableError` before the duck-type fallback. Those
 * error classes set `name`/`status`/`retryAfterSec` (and `upstream`) to exactly
 * the values the fallback checks, so genuine instances are matched identically
 * by the inlined predicates — there is no behavioural divergence.
 */

interface TransientErrorShape {
  name: unknown;
  status: unknown;
  retryAfterSec: unknown;
}

/**
 * Type guard for the rate-limit (HTTP 429) error shape. Mirrors the
 * bundle-split-safe duck-type fallback in `web/src/lib/resilience.ts`.
 */
function isRateLimitError(err: unknown): boolean {
  if (
    err &&
    typeof err === 'object' &&
    'name' in err &&
    'status' in err &&
    'retryAfterSec' in err
  ) {
    const e = err as TransientErrorShape;
    return e.name === 'RateLimitError' && e.status === 429 && typeof e.retryAfterSec === 'number';
  }
  return false;
}

/**
 * Type guard for the upstream-breaker-open (HTTP 503) error shape. Mirrors the
 * bundle-split-safe duck-type fallback in `web/src/lib/resilience.ts`.
 */
function isUpstreamUnavailableError(err: unknown): boolean {
  if (
    err &&
    typeof err === 'object' &&
    'name' in err &&
    'status' in err &&
    'retryAfterSec' in err &&
    'upstream' in err
  ) {
    const e = err as TransientErrorShape;
    return (
      e.name === 'UpstreamUnavailableError' &&
      e.status === 503 &&
      typeof e.retryAfterSec === 'number'
    );
  }
  return false;
}

/**
 * Returns true when the error is a recoverable wait — the user does
 * NOT need to take action, the system just needs to back off until the
 * upstream cooldown elapses. Used by {@link QueryError} to swap the
 * loud error UI for a quiet placeholder while the global banner shows
 * the countdown.
 */
export function isTransientWaiting(err: unknown): boolean {
  return isRateLimitError(err) || isUpstreamUnavailableError(err);
}
