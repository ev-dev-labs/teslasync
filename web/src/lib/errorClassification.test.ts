import { describe, it, expect } from 'vitest'
import { isTransientWaiting } from './errorClassification'
import {
  ApiError,
  RateLimitError,
  TeslaAuthExpiredError,
  UpstreamUnavailableError,
} from './resilience'

// isTransientWaiting is the single classifier QueryError consults to decide
// whether to render the calm "we're waiting it out" placeholder (rate-limited
// or upstream-breaker-open) instead of the loud "request failed" panel. These
// tests lock in every facet of that contract: real class instances, the
// bundle-split / serialization-survival duck-typed shapes, and the full set of
// negatives that MUST fall through to the normal error UI.

describe('isTransientWaiting — real error instances', () => {
  it('returns true for a RateLimitError (HTTP 429 back-off)', () => {
    const err = new RateLimitError('slow down', 30, '/vehicles')
    expect(isTransientWaiting(err)).toBe(true)
  })

  it('returns true for an UpstreamUnavailableError (breaker open, HTTP 503)', () => {
    const err = new UpstreamUnavailableError('breaker open', 45, 'tesla-fleet')
    expect(isTransientWaiting(err)).toBe(true)
  })

  it('returns true regardless of retryAfterSec magnitude (0 / large)', () => {
    expect(isTransientWaiting(new RateLimitError('x', 0, '/drives'))).toBe(true)
    expect(isTransientWaiting(new UpstreamUnavailableError('x', 3600, 'geocode'))).toBe(true)
  })
})

describe('isTransientWaiting — duck-typed shapes (bundle-split / serialized errors)', () => {
  // The guards intentionally survive the `instanceof` cliff: when the bundler
  // emits multiple copies of the class across chunks, or an error is round
  // tripped through structured-clone / JSON, only the plain shape remains.
  it('recognises a plain-object rate-limit shape', () => {
    const wireShape = { name: 'RateLimitError', status: 429, retryAfterSec: 12, scope: '/charging' }
    expect(isTransientWaiting(wireShape)).toBe(true)
  })

  it('recognises a plain-object upstream-unavailable shape', () => {
    const wireShape = {
      name: 'UpstreamUnavailableError',
      status: 503,
      retryAfterSec: 20,
      upstream: 'tesla-fleet',
    }
    expect(isTransientWaiting(wireShape)).toBe(true)
  })

  it('rejects an upstream shape missing the discriminating `upstream` field', () => {
    // Without `upstream` the duck-type guard cannot distinguish this from a
    // generic 503, so it must NOT claim the calm-waiting placeholder.
    const ambiguous = { name: 'UpstreamUnavailableError', status: 503, retryAfterSec: 20 }
    expect(isTransientWaiting(ambiguous)).toBe(false)
  })

  it('rejects a rate-limit shape whose status is not 429', () => {
    const wrongStatus = { name: 'RateLimitError', status: 500, retryAfterSec: 12 }
    expect(isTransientWaiting(wrongStatus)).toBe(false)
  })

  it('rejects a rate-limit shape whose retryAfterSec is not numeric', () => {
    const wrongType = { name: 'RateLimitError', status: 429, retryAfterSec: 'soon' }
    expect(isTransientWaiting(wrongType)).toBe(false)
  })
})

describe('isTransientWaiting — negative cases (must show the normal error UI)', () => {
  it('returns false for a generic 5xx ApiError', () => {
    expect(isTransientWaiting(new ApiError('boom', 500))).toBe(false)
  })

  it('returns false for a 404 ApiError', () => {
    expect(isTransientWaiting(new ApiError('missing', 404))).toBe(false)
  })

  it('returns false for a TeslaAuthExpiredError (needs user re-auth, not a wait)', () => {
    expect(isTransientWaiting(new TeslaAuthExpiredError('reauthorize'))).toBe(false)
  })

  it('returns false for a plain Error with no HTTP metadata', () => {
    expect(isTransientWaiting(new Error('network down'))).toBe(false)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['string', 'RateLimitError'],
    ['number 429', 429],
    ['zero', 0],
    ['boolean true', true],
    ['empty object', {}],
    ['array', []],
    ['object with unrelated name', { name: 'ValidationError', status: 429, retryAfterSec: 5 }],
  ])('returns false for %s', (_label, value) => {
    expect(isTransientWaiting(value)).toBe(false)
  })
})

describe('isTransientWaiting — semantics', () => {
  it('always returns a strict boolean, never a truthy/falsy passthrough', () => {
    expect(isTransientWaiting(new RateLimitError('x', 5, '/a'))).toStrictEqual(true)
    expect(isTransientWaiting(null)).toStrictEqual(false)
    expect(isTransientWaiting({})).toStrictEqual(false)
  })

  it('classifies both transient families identically (OR of the two guards)', () => {
    const rateLimited = new RateLimitError('x', 5, '/a')
    const breakerOpen = new UpstreamUnavailableError('x', 5, 'up')
    // Neither family is privileged over the other — both map to the same
    // calm-waiting branch in QueryError.
    expect(isTransientWaiting(rateLimited)).toBe(isTransientWaiting(breakerOpen))
    expect([isTransientWaiting(rateLimited), isTransientWaiting(breakerOpen)]).toEqual([true, true])
  })
})
