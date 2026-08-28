import { describe, it, expect } from 'vitest'

import {
  FORBIDDEN_BUNDLE_PATTERNS,
  MAX_BUNDLE_ERRORS,
  MAX_BUNDLE_TRACE_IDS,
  SUPPORT_BUNDLE_SCHEMA_VERSION,
  browserFamily,
  buildSupportBundle,
  findForbiddenContent,
  sanitizeTraceIds,
  serializeSupportBundle,
  supportBundleFilename,
  viewportBucket,
} from '../supportBundle'

/**
 * HELP-08. This is a privacy test suite before it is a behaviour test suite.
 *
 * The adversarial cases below are not hypothetical — every one of them is a
 * value that really does end up in an error message, a service name or a
 * health payload in this app: a VIN in a route, a token in a failed request
 * URL, an e-mail from a forward-auth header, a coordinate pair from a map
 * fetch. If the bundle leaks any of them, "privacy-safe" is a false claim.
 */

const VIN = '5YJ3E1EA7KF317654'
const EMAIL = 'owner@example.com'
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const COORDS = '37.774929,-122.419418'

describe('buildSupportBundle — shape', () => {
  it('emits the schema version and a stable top-level shape', () => {
    const bundle = buildSupportBundle({ generatedAt: '2026-01-02T03:04:05.000Z' })
    expect(bundle.schema_version).toBe(SUPPORT_BUNDLE_SCHEMA_VERSION)
    expect(Object.keys(bundle).sort()).toEqual([
      'app',
      'browser',
      'demo_mode',
      'errors',
      'generated_at',
      'health',
      'schema_version',
      'trace_ids',
    ])
  })

  it('never emits a raw user-agent field', () => {
    const bundle = buildSupportBundle({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 CorporateBuild/ACME-1234',
    })
    const serialized = serializeSupportBundle(bundle)
    expect(serialized).not.toContain('CorporateBuild')
    expect(serialized).not.toContain('Mozilla/5.0')
    expect(bundle.browser.family).toBe('Chrome')
    expect(bundle.browser.major_version).toBe('120')
  })

  it('defaults every unknown field rather than emitting undefined', () => {
    const bundle = buildSupportBundle()
    expect(bundle.app.version).toBe('unknown')
    expect(bundle.health.overall).toBe('unknown')
    expect(bundle.browser.family).toBe('unknown')
    expect(bundle.errors).toEqual([])
    expect(bundle.trace_ids).toEqual([])
  })

  it('caps the error list to the most recent N', () => {
    const errors = Array.from({ length: MAX_BUNDLE_ERRORS + 5 }, (_, i) => ({
      name: 'Error',
      message: `boom ${i}`,
      route: '/drives/1',
      occurred_at: '2026-01-01T00:00:00.000Z',
    }))
    const bundle = buildSupportBundle({ errors })
    expect(bundle.errors).toHaveLength(MAX_BUNDLE_ERRORS)
    // The most recent entries are kept, not the oldest.
    expect(bundle.errors[bundle.errors.length - 1].message).toContain(
      `boom ${MAX_BUNDLE_ERRORS + 4}`,
    )
  })

  it('produces an identifier-free, deterministic filename', () => {
    const bundle = buildSupportBundle({ generatedAt: '2026-01-02T03:04:05.000Z' })
    expect(supportBundleFilename(bundle)).toBe('teslasync-support-2026-01-02T03-04-05.json')
  })
})

describe('buildSupportBundle — redaction (privacy)', () => {
  it('strips a VIN embedded in an error message', () => {
    const bundle = buildSupportBundle({
      errors: [{ name: 'Error', message: `no state for ${VIN}`, route: '/', occurred_at: '' }],
    })
    const serialized = serializeSupportBundle(bundle)
    expect(serialized).not.toContain(VIN)
    expect(findForbiddenContent(serialized)).toEqual([])
  })

  it('strips an e-mail address from a health service name', () => {
    const bundle = buildSupportBundle({
      healthServices: [{ name: `auth (${EMAIL})`, status: 'degraded' }],
    })
    const serialized = serializeSupportBundle(bundle)
    expect(serialized).not.toContain(EMAIL)
    expect(findForbiddenContent(serialized)).toEqual([])
  })

  it('strips a JWT and a bearer header from an error message', () => {
    const bundle = buildSupportBundle({
      errors: [
        {
          name: 'ApiError',
          message: `401 with Authorization: Bearer ${JWT}`,
          route: '/',
          occurred_at: '',
        },
      ],
    })
    const serialized = serializeSupportBundle(bundle)
    expect(serialized).not.toContain(JWT)
    expect(findForbiddenContent(serialized)).toEqual([])
  })

  it('strips a coordinate pair', () => {
    const bundle = buildSupportBundle({
      errors: [
        { name: 'Error', message: `geocode failed at ${COORDS}`, route: '/', occurred_at: '' },
      ],
    })
    expect(findForbiddenContent(serializeSupportBundle(bundle))).toEqual([])
  })

  it('templates the error route instead of carrying record ids or share tokens', () => {
    const bundle = buildSupportBundle({
      errors: [
        { name: 'Error', message: 'x', route: '/drives/91827', occurred_at: '' },
        { name: 'Error', message: 'y', route: '/s/share-token-abcdef', occurred_at: '' },
      ],
    })
    expect(bundle.errors[0].route_template).toBe('/drives/:id')
    expect(bundle.errors[1].route_template).not.toContain('share-token-abcdef')
  })

  it('drops a query string carrying a token out of an error message', () => {
    const bundle = buildSupportBundle({
      errors: [
        {
          name: 'Error',
          message: 'GET https://host/api/v1/vehicles?access_token=supersecretvalue failed',
          route: '/',
          occurred_at: '',
        },
      ],
    })
    const serialized = serializeSupportBundle(bundle)
    expect(serialized).not.toContain('supersecretvalue')
  })

  it('holds the line for every forbidden pattern at once', () => {
    const bundle = buildSupportBundle({
      appVersion: `1.0.0 ${VIN}`,
      releaseChannel: EMAIL,
      healthOverall: COORDS,
      healthServices: [{ name: 'db', status: `Bearer ${JWT}` }],
      errors: [
        {
          name: VIN,
          message: `${EMAIL} ${COORDS} ${JWT}`,
          route: `/vehicles/${VIN}`,
          occurred_at: '',
        },
      ],
    })
    const found = findForbiddenContent(serializeSupportBundle(bundle))
    expect(found).toEqual([])
    expect(FORBIDDEN_BUNDLE_PATTERNS.length).toBeGreaterThan(0)
  })
})

describe('sanitizeTraceIds', () => {
  it('accepts well-formed 32-hex trace ids and lower-cases them', () => {
    expect(sanitizeTraceIds(['4BF92F3577B34DA6A3CE929D0E0E4736'])).toEqual([
      '4bf92f3577b34da6a3ce929d0e0e4736',
    ])
  })

  it('accepts 16-hex span-width ids', () => {
    expect(sanitizeTraceIds(['00f067aa0ba902b7'])).toEqual(['00f067aa0ba902b7'])
  })

  it('drops anything that is not opaque hex — including smuggled text', () => {
    expect(
      sanitizeTraceIds([
        'owner@example.com',
        '5YJ3E1EA7KF317654',
        'short',
        '',
        'zzzzzzzzzzzzzzzz',
      ]),
    ).toEqual([])
  })

  it('de-duplicates and caps the list', () => {
    const id = '4bf92f3577b34da6a3ce929d0e0e4736'
    expect(sanitizeTraceIds([id, id, id])).toEqual([id])
    const many = Array.from({ length: MAX_BUNDLE_TRACE_IDS + 10 }, (_, i) =>
      i.toString(16).padStart(16, '0'),
    )
    expect(sanitizeTraceIds(many).length).toBeLessThanOrEqual(MAX_BUNDLE_TRACE_IDS)
  })

  it('tolerates a non-array input', () => {
    expect(sanitizeTraceIds(undefined)).toEqual([])
  })
})

describe('browserFamily', () => {
  it('prefers Edge over the Chrome token it also carries', () => {
    expect(
      browserFamily(
        'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      ),
    ).toEqual({ family: 'Edge', major_version: '120' })
  })

  it('identifies Safari via the Version/ token, not the Safari/ build number', () => {
    expect(
      browserFamily(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.2 Safari/605.1.15',
      ),
    ).toEqual({ family: 'Safari', major_version: '17' })
  })

  it('identifies Firefox', () => {
    expect(browserFamily('Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0')).toEqual(
      { family: 'Firefox', major_version: '121' },
    )
  })

  it('returns unknown for an empty or unrecognised agent', () => {
    expect(browserFamily(undefined)).toEqual({ family: 'unknown', major_version: '' })
    expect(browserFamily('curl/8.4.0')).toEqual({ family: 'unknown', major_version: '' })
  })
})

describe('viewportBucket', () => {
  it('buckets rather than reporting exact pixels', () => {
    expect(viewportBucket(375)).toBe('xs')
    expect(viewportBucket(700)).toBe('sm')
    expect(viewportBucket(900)).toBe('md')
    expect(viewportBucket(1280)).toBe('lg')
    expect(viewportBucket(1920)).toBe('xl')
  })

  it('reports unknown for a missing or nonsensical width', () => {
    expect(viewportBucket(undefined)).toBe('unknown')
    expect(viewportBucket(0)).toBe('unknown')
    expect(viewportBucket(Number.NaN)).toBe('unknown')
  })
})
