import { describe, expect, it } from 'vitest'

import {
  APP_VERSION,
  BUILD_ID,
  CACHE_PREFIX,
  UNVERSIONED_BUCKETS,
  VERSIONED_BUCKETS,
  cacheName,
  compareVersions,
  currentCacheNames,
  evaluateContractHandshake,
  isOwnedCacheName,
  parseVersion,
  staleCacheNames,
} from '../buildContract'

/**
 * Build identity, cache versioning and the API-contract handshake (PWA-04).
 *
 * These are the invariants that stop a returning PWA from pairing a previous
 * build's cached JavaScript with a newer backend.
 */

describe('cache naming', () => {
  it('embeds the build id in every contract-bearing bucket', () => {
    for (const bucket of VERSIONED_BUCKETS) {
      expect(cacheName(bucket)).toBe(`${CACHE_PREFIX}-${bucket}-${BUILD_ID}`)
    }
  })

  it('leaves third-party buckets unversioned so deploys do not re-download them', () => {
    for (const bucket of UNVERSIONED_BUCKETS) {
      expect(cacheName(bucket)).toBe(`${CACHE_PREFIX}-${bucket}`)
      expect(cacheName(bucket)).not.toContain(BUILD_ID)
    }
  })

  it('claims every bucket it names and nothing else', () => {
    const current = currentCacheNames()
    expect(current).toHaveLength(
      VERSIONED_BUCKETS.length + UNVERSIONED_BUCKETS.length,
    )
    expect(new Set(current).size).toBe(current.length)
    expect(current.every(isOwnedCacheName)).toBe(true)
  })
})

describe('staleCacheNames', () => {
  it('deletes a previous build’s versioned caches', () => {
    const previous = `${CACHE_PREFIX}-app-route-assets-1.0.0+deadbee`
    expect(staleCacheNames([previous, ...currentCacheNames()])).toEqual([previous])
  })

  it('never touches caches this build owns', () => {
    expect(staleCacheNames(currentCacheNames())).toEqual([])
  })

  it('never touches caches belonging to other software on the origin', () => {
    const foreign = ['workbox-precache-v2', 'some-other-app-v1', 'teslasync']
    expect(staleCacheNames(foreign)).toEqual([])
  })
})

describe('parseVersion / compareVersions', () => {
  it.each([
    ['2.0.0', { major: 2, minor: 0, patch: 0 }],
    ['v3.4', { major: 3, minor: 4, patch: 0 }],
    ['10', { major: 10, minor: 0, patch: 0 }],
    ['1.2.3-rc.1', { major: 1, minor: 2, patch: 3 }],
  ])('parses %s', (input, expected) => {
    expect(parseVersion(input)).toEqual(expected)
  })

  it.each(['dev', 'unknown', '', 'v', null, undefined, 42])(
    'returns null for the unusable value %s',
    (input) => {
      expect(parseVersion(input)).toBeNull()
    },
  )

  it('orders by major, then minor, then patch', () => {
    const a = { major: 1, minor: 2, patch: 3 }
    expect(compareVersions(a, { major: 2, minor: 0, patch: 0 })).toBe(-1)
    expect(compareVersions(a, { major: 1, minor: 1, patch: 9 })).toBe(1)
    expect(compareVersions(a, { major: 1, minor: 2, patch: 3 })).toBe(0)
  })
})

describe('evaluateContractHandshake', () => {
  it('treats a matching major.minor as compatible', () => {
    const result = evaluateContractHandshake({
      clientAppVersion: '2.0.0',
      serverAppVersion: '2.0.0',
    })
    expect(result.verdict).toBe('compatible')
    expect(result.updateRequired).toBe(false)
  })

  it('tolerates patch drift during a rolling deploy', () => {
    // Half the pods answering 2.0.7 while the browser has 2.0.3 must not nag.
    expect(
      evaluateContractHandshake({
        clientAppVersion: '2.0.3',
        serverAppVersion: '2.0.7',
      }),
    ).toMatchObject({ verdict: 'compatible', updateRequired: false })
  })

  it('requires an update when the server moved ahead by a minor', () => {
    const result = evaluateContractHandshake({
      clientAppVersion: '2.0.9',
      serverAppVersion: '2.1.0',
    })
    expect(result.verdict).toBe('assets-stale')
    expect(result.updateRequired).toBe(true)
  })

  it('requires an update when the server moved ahead by a major', () => {
    expect(
      evaluateContractHandshake({
        clientAppVersion: '2.9.9',
        serverAppVersion: '3.0.0',
      }),
    ).toMatchObject({ verdict: 'assets-stale', updateRequired: true })
  })

  it('never forces a downgrade when the server is behind', () => {
    const result = evaluateContractHandshake({
      clientAppVersion: '3.0.0',
      serverAppVersion: '2.4.0',
    })
    expect(result.verdict).toBe('server-behind')
    expect(result.updateRequired).toBe(false)
  })

  it.each([undefined, null, 'dev', 'unknown', 123])(
    'stays silent when the server reports the unusable version %s',
    (serverAppVersion) => {
      expect(
        evaluateContractHandshake({
          clientAppVersion: '2.0.0',
          serverAppVersion,
        }),
      ).toMatchObject({ verdict: 'unknown', updateRequired: false })
    },
  )

  it('defaults the client version to this build', () => {
    expect(evaluateContractHandshake().clientVersion).toBe(APP_VERSION)
  })
})
