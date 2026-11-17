import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  observeRateLimit, rateLimitContext, rateLimitFor, reserveRateLimitRead, resetRateLimits,
} from '../rateLimit'
import { __resetBroadcastForTests } from '../broadcast'
import * as bus from '../broadcast'
import { retryAfterSeconds } from '../retryAfter'
import { ratePolicyHeaders, TEST_RATE_BUCKET } from '@/test/rateLimit'

const NOW = Date.parse('2026-06-01T12:00:00Z')
let context: number

function response(status = 429, headers = ratePolicyHeaders()): Response {
  return new Response('{}', { status, headers })
}

function peerCooldown(bucket: string, expiresAt: number) {
  window.dispatchEvent(new StorageEvent('storage', {
    key: '__teslasync_bus_quota_test',
    newValue: JSON.stringify({
      _from: 'peer-tab', _ts: Date.now(), msg: { type: 'rateLimit.cooldown', bucket, expiresAt },
    }),
  }))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  resetRateLimits()
  context = rateLimitContext('https://api.example.test/api/v1/vehicles')
})

afterEach(() => {
  resetRateLimits()
  __resetBroadcastForTests()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('Retry-After timing', () => {
  it.each([
    ['90', 90], ['0', 0], [' 2 ', 2], [null, 60], ['', 60], ['soon', 60],
    ['-1', 60], ['1.5', 60], ['2seconds', 60], ['99999999999999999999', 60],
    ['Mon, 01 Jun 2026 12:01:30 GMT', 90], ['Mon, 01 Jun 2026 11:59:30 GMT', 0],
  ])('parses %s as %s seconds', (value, expected) => {
    expect(retryAfterSeconds(value as string | null, null, NOW)).toBe(expected)
  })

  it('uses the server Date for an HTTP-date despite client clock skew', () => {
    expect(retryAfterSeconds(
      'Mon, 01 Jun 2026 12:01:30 GMT', 'Mon, 01 Jun 2026 12:00:00 GMT', NOW + 86_400_000,
    )).toBe(90)
    expect(retryAfterSeconds('Mon, 01 Jun 2026 12:01:30 GMT', '2', NOW)).toBe(90)
  })
})

describe('server-scoped quota coordination', () => {
  it('pauses only the enforced route and method, across route parameters', () => {
    observeRateLimit(response(), '/vehicles/7/refresh', 'POST', context)
    expect(rateLimitFor('/vehicles/9/refresh', 'POST')?.source).toBe('teslasync')
    expect(rateLimitFor('/vehicles/7/refresh', 'GET')).toBeUndefined()
    expect(rateLimitFor('/vehicles/7/state', 'GET')).toBeUndefined()
    expect(rateLimitFor('/vehicles/7/command', 'POST')).toBeUndefined()
  })

  it('a write-only backstop never pauses reads', () => {
    observeRateLimit(response(429, ratePolicyHeaders({ scope: '/*', methods: 'WRITE' })),
      '/alerts', 'POST', context)
    expect(rateLimitFor('/vehicles/9/wake', 'POST')?.methods).toBe('WRITE')
    expect(rateLimitFor('/alerts', 'GET')).toBeUndefined()
    expect(rateLimitFor('/alerts', 'HEAD')).toBeUndefined()
  })

  it('shares the actual route-group quota without blocking another group', () => {
    const headers = ratePolicyHeaders({ scope: '/settings/*', methods: '*' })
    observeRateLimit(response(200, headers), '/settings/preferences', 'GET', context)
    observeRateLimit(response(429, headers), '/settings/other', 'GET', context)
    expect(rateLimitFor('/settings/preferences', 'GET')?.bucket).toBe(TEST_RATE_BUCKET)
    expect(rateLimitFor('/vehicles', 'GET')).toBeUndefined()
  })

  it('unknown 429s pause only the exact resource and method, ignoring query variants', () => {
    observeRateLimit(response(429, { 'Retry-After': '5' }), '/vehicles/7/state?fields=a', 'GET', context)
    expect(rateLimitFor('/vehicles/7/state?fields=b', 'GET')?.source).toBe('unknown')
    expect(rateLimitFor('/vehicles/9/state', 'GET')).toBeUndefined()
    expect(rateLimitFor('/vehicles/7/state', 'POST')).toBeUndefined()
  })

  it('does not trust inherited local-limit metadata on an unmarked upstream 429', () => {
    const headers = ratePolicyHeaders({ scope: '/*', methods: '*' })
    delete headers['X-RateLimit-Limited']
    observeRateLimit(response(429, headers), '/vehicles/7/refresh', 'POST', context)
    expect(rateLimitFor('/vehicles/7/refresh', 'POST')?.source).toBe('unknown')
    expect(rateLimitFor('/charging', 'GET')).toBeUndefined()
  })

  it('keeps the longer deadline when responses arrive out of order or a read succeeds', () => {
    const headers = ratePolicyHeaders({ scope: '/vehicles', methods: 'GET' })
    observeRateLimit(response(429, { ...headers, 'Retry-After': '30' }), '/vehicles', 'GET', context)
    observeRateLimit(response(429, { ...headers, 'Retry-After': '2' }), '/vehicles', 'GET', context)
    observeRateLimit(response(200, headers), '/vehicles', 'GET', context)
    expect(rateLimitFor('/vehicles')?.retryAfterSec).toBe(30)
  })

  it('clears a recovered fallback notice even when a proxy emits no quota policy on success', () => {
    const cleared = vi.fn()
    document.addEventListener('teslasync:rate-limit-cleared', cleared)
    observeRateLimit(response(429, { 'Retry-After': '1' }), '/vehicles', 'GET', context)
    vi.setSystemTime(NOW + 1000)
    observeRateLimit(response(200, {}), '/vehicles', 'GET', context)
    expect(cleared).toHaveBeenCalledTimes(1)
    document.removeEventListener('teslasync:rate-limit-cleared', cleared)
  })

  it('paces recovery without letting rejected reservations prolong the queue', () => {
    observeRateLimit(response(429, ratePolicyHeaders({ scope: '/vehicles', methods: 'GET' })),
      '/vehicles', 'GET', context)
    vi.setSystemTime(NOW + 10_000)
    expect(reserveRateLimitRead('/vehicles', 'GET').waitMs).toBe(0)
    const held: (() => void)[] = []
    let deferred = 0
    for (let i = 0; i < 100; i++) {
      const slot = reserveRateLimitRead('/vehicles', 'GET')
      if (slot.deferred) deferred++
      else {
        expect(slot.waitMs).toBeLessThanOrEqual(5000)
        held.push(slot.release)
      }
    }
    expect(deferred).toBeGreaterThan(0)
    expect(reserveRateLimitRead('/vehicles', 'GET', 'high').waitMs).toBe(0)
    expect(reserveRateLimitRead('/vehicles', 'POST').waitMs).toBe(0)
    held.forEach((release) => release())
    vi.setSystemTime(NOW + 16_000)
    expect(reserveRateLimitRead('/vehicles', 'GET').deferred).toBeUndefined()
  })

  it('does not evict an active deadline when learning many advisory policies', () => {
    observeRateLimit(response(), '/vehicles/7/refresh', 'POST', context)
    for (let i = 0; i < 260; i++) {
      observeRateLimit(response(200, ratePolicyHeaders({
        bucket: i.toString(16).padStart(32, '0'), scope: `/advisory/${i}`, methods: 'GET',
      })), `/advisory/${i}`, 'GET', context)
    }
    expect(rateLimitFor('/vehicles/9/refresh', 'POST')?.retryAfterSec).toBe(10)
  })

  it('shares an anonymous group quota without claiming excluded sibling routes', () => {
    observeRateLimit(response(429, ratePolicyHeaders({
      scope: '/settings /settings/polling-config', methods: '*',
    })), '/settings', 'GET', context)
    expect(rateLimitFor('/settings', 'PUT')).toBeDefined()
    expect(rateLimitFor('/settings/polling-config', 'GET')).toBeDefined()
    expect(rateLimitFor('/settings/widget-design-pack', 'GET')).toBeUndefined()
    expect(rateLimitFor('/vehicles', 'GET')).toBeUndefined()
  })

  it.each(['/settings /vehicle*', '/settings /vehicles?token=x'])(
    'rejects malformed scope lists instead of trusting a partially valid policy: %s',
    (scope) => {
      observeRateLimit(response(429, ratePolicyHeaders({ scope, methods: '*' })), '/settings', 'GET', context)
      expect(rateLimitFor('/settings', 'GET')?.source).toBe('unknown')
      expect(rateLimitFor('/settings', 'PUT')).toBeUndefined()
      expect(rateLimitFor('/vehicles', 'GET')).toBeUndefined()
    },
  )

  it('does not reject an immediately available read merely because another quota fills the waiting queue', () => {
    for (let i = 0; i < 33; i++) {
      observeRateLimit(response(429, ratePolicyHeaders({
        bucket: (i + 1).toString(16).padStart(32, '0'), scope: `/read/${i}`, methods: 'GET',
      })), `/read/${i}`, 'GET', context)
    }
    vi.setSystemTime(NOW + 10_000)
    const release: (() => void)[] = []
    for (let i = 0; i < 32; i++) {
      reserveRateLimitRead(`/read/${i}`, 'GET')
      const waiting = reserveRateLimitRead(`/read/${i}`, 'GET')
      expect(waiting.waitMs).toBeGreaterThan(0)
      release.push(waiting.release)
    }
    const ready = reserveRateLimitRead('/read/32', 'GET')
    expect(ready.waitMs).toBe(0)
    expect(ready.deferred).toBeUndefined()
    release.forEach((done) => done())
  })

  it('trusts peer cooldowns only for an independently learned, identity-bound bucket', () => {
    peerCooldown(TEST_RATE_BUCKET, NOW + 20_000)
    expect(rateLimitFor('/vehicles/7/refresh', 'POST')).toBeUndefined()
    observeRateLimit(response(200), '/vehicles/7/refresh', 'POST', context)
    expect(rateLimitFor('/vehicles/7/refresh', 'POST')?.retryAfterSec).toBe(20)
    peerCooldown('b'.repeat(32), NOW + 60_000)
    expect(rateLimitFor('/vehicles/7/refresh', 'POST')?.retryAfterSec).toBe(20)
  })

  it('does not resurrect an expired peer cooldown after a successful recovery', () => {
    peerCooldown(TEST_RATE_BUCKET, NOW + 1000)
    observeRateLimit(response(200), '/vehicles/7/refresh', 'POST', context)
    const notice = vi.fn()
    document.addEventListener('teslasync:rate-limited', notice)
    vi.setSystemTime(NOW + 1000)
    observeRateLimit(response(200), '/vehicles/7/refresh', 'POST', context)
    expect(notice).not.toHaveBeenCalled()
    expect(rateLimitFor('/vehicles/7/refresh', 'POST')).toBeUndefined()
    document.removeEventListener('teslasync:rate-limited', notice)
  })

  it('broadcasts only the opaque bucket and deadline, never credentials or paths', () => {
    const send = vi.spyOn(bus, 'broadcast')
    context = rateLimitContext('https://api.example.test/api/v1/vehicles', { Authorization: 'Bearer test-credential' })
    observeRateLimit(response(), '/vehicles/7/refresh', 'POST', context)
    expect(send).toHaveBeenLastCalledWith({
      type: 'rateLimit.cooldown', bucket: TEST_RATE_BUCKET, expiresAt: NOW + 10_000,
    })
    expect(JSON.stringify(send.mock.calls)).not.toContain('test-credential')
    expect(JSON.stringify(send.mock.calls)).not.toContain('/vehicles')
  })

  it('drops old server/account state and ignores late responses from the previous context', () => {
    observeRateLimit(response(), '/vehicles/7/refresh', 'POST', context)
    rateLimitContext('https://other.example.test/api/v1/vehicles', { Authorization: 'Bearer another-account' })
    expect(rateLimitFor('/vehicles/7/refresh', 'POST')).toBeUndefined()
    expect(observeRateLimit(response(), '/vehicles/7/refresh', 'POST', context)).toBeUndefined()
    expect(rateLimitFor('/vehicles/7/refresh', 'POST')).toBeUndefined()
  })
})
