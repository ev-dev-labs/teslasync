import { describe, expect, it } from 'vitest'

import {
  API_CACHE_MAX_AGE_SECONDS,
  CACHEABLE_READ_PATTERNS,
  CACHED_AT_HEADER,
  SENSITIVE_PATH_MARKERS,
  classifyApiRequest,
  isCachedEntryExpired,
  isCacheableApiResponse,
  readCachedAt,
} from '../apiCachePolicy'

/**
 * The authenticated-read caching policy (PWA-02).
 *
 * The contract these tests defend: only vetted, read-only, non-secret GETs
 * may ever be written to Cache Storage, and a ForwardAuth redirect can never
 * be stored under an API URL.
 */

const ORIGIN = 'https://teslasync.example'

function classify(
  path: string,
  method = 'GET',
  extra: { origin?: string; hasRangeHeader?: boolean } = {},
) {
  return classifyApiRequest({
    method,
    url: `${extra.origin ?? ORIGIN}${path}`,
    origin: ORIGIN,
    hasRangeHeader: extra.hasRangeHeader,
  })
}

function response(init: {
  status?: number
  redirected?: boolean
  type?: string
  headers?: Record<string, string>
}) {
  const headers = init.headers ?? {}
  return {
    status: init.status ?? 200,
    redirected: init.redirected ?? false,
    type: init.type,
    url: `${ORIGIN}/api/v1/vehicles`,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  }
}

describe('classifyApiRequest — allowlisted reads', () => {
  it.each(['/api/v1/vehicles', '/api/v1/drives', '/api/v1/charging', '/api/v1/system/version'])(
    'caches the vetted read %s',
    (path) => {
      expect(classify(path)).toMatchObject({ cacheable: true, reason: 'cacheable-read' })
    },
  )

  it('matches parameterised reads only for a positive integer id', () => {
    expect(classify('/api/v1/vehicles/7/state').cacheable).toBe(true)
    expect(classify('/api/v1/vehicles/0/state').cacheable).toBe(false)
    expect(classify('/api/v1/vehicles/abc/state').cacheable).toBe(false)
    expect(classify('/api/v1/vehicles/7/state/extra').cacheable).toBe(false)
  })

  it('keeps the query string out of the path match', () => {
    expect(classify('/api/v1/drives?limit=50&vehicle_id=3').cacheable).toBe(true)
  })
})

describe('classifyApiRequest — refusals', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])(
    'never caches the %s mutation of an otherwise-allowlisted path',
    (method) => {
      expect(classify('/api/v1/vehicles', method)).toMatchObject({
        cacheable: false,
        reason: 'mutation',
      })
    },
  )

  it('never caches a cross-origin request', () => {
    expect(
      classify('/api/v1/vehicles', 'GET', { origin: 'https://evil.example' }),
    ).toMatchObject({ cacheable: false, reason: 'cross-origin' })
  })

  it('ignores anything outside the /api/v1 namespace', () => {
    expect(classify('/assets/index.js')).toMatchObject({ reason: 'not-api' })
    expect(classify('/api/v2/vehicles')).toMatchObject({ reason: 'not-api' })
    expect(classify('/api/v1beta/vehicles')).toMatchObject({ reason: 'not-api' })
  })

  it('never caches a partial response', () => {
    expect(
      classify('/api/v1/vehicles', 'GET', { hasRangeHeader: true }),
    ).toMatchObject({ cacheable: false, reason: 'range-request' })
  })

  it.each([
    '/api/v1/settings',
    '/api/v1/admin/audit-log',
    '/api/v1/push/public-key',
    '/api/v1/exports',
    '/api/v1/account/sessions',
    '/api/v1/sharing/tokens',
  ])('refuses the sensitive path %s', (path) => {
    const decision = classify(path)
    expect(decision.cacheable).toBe(false)
    expect(['sensitive-path', 'not-allowlisted']).toContain(decision.reason)
  })

  it('defaults new endpoints to network-only', () => {
    expect(classify('/api/v1/some/brand/new/endpoint')).toMatchObject({
      cacheable: false,
      reason: 'not-allowlisted',
    })
  })
})

describe('allowlist hygiene', () => {
  it('contains no entry that its own sensitive-marker guard would reject', () => {
    for (const pattern of CACHEABLE_READ_PATTERNS) {
      const lower = pattern.toLowerCase()
      const hit = SENSITIVE_PATH_MARKERS.find((marker) => lower.includes(marker))
      expect(hit, `${pattern} contains marker ${hit}`).toBeUndefined()
    }
  })

  it('is entirely absolute paths without the /api/v1 prefix', () => {
    for (const pattern of CACHEABLE_READ_PATTERNS) {
      expect(pattern.startsWith('/')).toBe(true)
      expect(pattern.startsWith('/api/')).toBe(false)
    }
  })
})

describe('isCacheableApiResponse', () => {
  it('accepts a plain 200', () => {
    expect(isCacheableApiResponse(response({}))).toBe(true)
  })

  it('refuses a ForwardAuth redirect so a login page is never stored as data', () => {
    expect(isCacheableApiResponse(response({ redirected: true }))).toBe(false)
  })

  it.each([201, 204, 302, 401, 404, 500])('refuses status %i', (status) => {
    expect(isCacheableApiResponse(response({ status }))).toBe(false)
  })

  it.each(['opaque', 'opaqueredirect'])('refuses the %s response type', (type) => {
    expect(isCacheableApiResponse(response({ type }))).toBe(false)
  })

  it('refuses a response that rotates a session cookie', () => {
    expect(
      isCacheableApiResponse(response({ headers: { 'set-cookie': 'sid=abc' } })),
    ).toBe(false)
  })

  it.each(['no-store', 'private, max-age=0', 'No-Store'])(
    'honours Cache-Control: %s',
    (cacheControl) => {
      expect(
        isCacheableApiResponse(response({ headers: { 'cache-control': cacheControl } })),
      ).toBe(false)
    },
  )
})

describe('cached-at disclosure', () => {
  it('reads the stamped capture time', () => {
    const now = 1_700_000_000_000
    expect(
      readCachedAt(response({ headers: { [CACHED_AT_HEADER]: String(now) } })),
    ).toBe(now)
  })

  it.each([undefined, 'not-a-number', '0', '-5'])(
    'reports an unusable stamp (%s) as unknown rather than as "now"',
    (raw) => {
      const headers = raw === undefined ? {} : { [CACHED_AT_HEADER]: raw }
      expect(readCachedAt(response({ headers }))).toBeNull()
    },
  )

  it('treats an unknown capture time as expired', () => {
    expect(isCachedEntryExpired(null, Date.now())).toBe(true)
  })

  it('expires entries older than the max age', () => {
    const now = 1_700_000_000_000
    const maxAgeMs = API_CACHE_MAX_AGE_SECONDS * 1000
    expect(isCachedEntryExpired(now - maxAgeMs + 1000, now)).toBe(false)
    expect(isCachedEntryExpired(now - maxAgeMs - 1000, now)).toBe(true)
  })
})
