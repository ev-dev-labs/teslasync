import { describe, it, expect } from 'vitest'

import {
  ID_PLACEHOLDER,
  MAX_ROUTE_LENGTH,
  MAX_ROUTE_SEGMENTS,
  normalizeRouteTemplate,
  redactLocationInText,
  redactUrlsInText,
  safeDecodeSegment,
  stripUrlQueryAndHash,
} from '../routeTemplate'
import { ROUTE_REGISTRY } from '../routeRegistry'

/**
 * Shared route templater.
 *
 * The motivating bug: `/s/share-token-abc` is lowercase words with hyphens and
 * no digits — byte-for-byte the same SHAPE as `/analytics/battery-degradation`.
 * Shape heuristics alone therefore preserved the share token, which then sat in
 * a buffered error payload until the consent policy resolved and POSTed it.
 * The route registry is what closes that gap.
 */

describe('routeTemplate — registry-driven parameters', () => {
  it('templates the share-link token that shape heuristics cannot detect', () => {
    expect(normalizeRouteTemplate('/s/share-token-abc')).toBe('/s/:id')
    expect(normalizeRouteTemplate('/s/ShareTokenAbc')).toBe('/s/:id')
    expect(normalizeRouteTemplate('/s/a')).toBe('/s/:id')
  })

  it('templates every parameterised route the registry knows about', () => {
    const cases: Array<[string, string]> = [
      ['/year-review/2024', '/year-review/:id'],
      ['/year-review/twenty-twenty-four', '/year-review/:id'],
      ['/vehicles/17', '/vehicles/:id'],
      ['/vehicles/5YJ3E1EA7JF000316', '/vehicles/:id'],
      ['/vehicles/17/access', '/vehicles/:id/access'],
      ['/drives/48291', '/drives/:id'],
      ['/drives/48291/replay', '/drives/:id/replay'],
      ['/charging/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', '/charging/:id'],
      ['/trips/abc-def-ghi', '/trips/:id'],
      ['/automations/my-automation/edit', '/automations/:id/edit'],
      ['/system-status/incidents/inc-2024-a', '/system-status/incidents/:id'],
    ]
    for (const [input, expected] of cases) {
      expect(normalizeRouteTemplate(input)).toBe(expected)
    }
  })

  it('prefers the literal route when a parameterised one has the same shape', () => {
    expect(normalizeRouteTemplate('/automations/list')).toBe('/automations/list')
    expect(normalizeRouteTemplate('/automations/new')).toBe('/automations/new')
    expect(normalizeRouteTemplate('/vehicles/list/state')).toBe('/vehicles/list/state')
  })

  it('leaves ordinary static routes alone', () => {
    for (const input of [
      '/dashboard',
      '/analytics/battery-degradation',
      '/account/2fa',
      '/watch',
      '/quick-stats',
      '/',
    ]) {
      expect(normalizeRouteTemplate(input)).toBe(input === '/' ? '/' : input.toLowerCase())
    }
  })

  it('every registry :param position resolves to the placeholder', () => {
    const parameterised = ROUTE_REGISTRY.filter(e => e.path.includes('/:'))
    expect(parameterised.length).toBeGreaterThan(0)
    for (const entry of parameterised) {
      const probe = entry.path
        .split('/')
        .map(seg => (seg.startsWith(':') ? 'OpaqueValueXYZ' : seg))
        .join('/')
      const templated = normalizeRouteTemplate(probe)
      expect(templated).not.toContain('OpaqueValueXYZ')
      expect(templated).not.toContain('opaquevaluexyz')
      // Depth/length caps may truncate, but every surviving param position is
      // the placeholder.
      expect(templated.startsWith(entry.path.split('/:')[0].toLowerCase())).toBe(true)
    }
  })
})

describe('routeTemplate — shape heuristics still apply off-registry', () => {
  it.each([
    ['', '/'],
    ['/', '/'],
    ['/Dashboard', '/dashboard'],
    ['/drives/123/telemetry', '/drives/:id/telemetry'],
    ['/c/9b1deb4d3b7d4bad9bdd2b0d7b3dcb6d', '/c/:id'],
    ['/share/abcdef0123456789abcdef', '/share/:id'],
    ['/map/37.7749,-122.4194', '/map/:id'],
    ['/map/37.7749', '/map/:id'],
    ['/user/jane.doe@example.com', '/user/:id'],
    ['/search/%2Fsecret', '/search/:id'],
    ['/share/aB3xQ9zL2mK7', '/share/:id'],
    ['/search/Berlin Straße', '/search/:id'],
    ['dashboard', '/dashboard'],
    ['/dashboard/', '/dashboard'],
    ['/a//b', '/a/b'],
    ['https://tenant.example.com/dashboard', '/dashboard'],
  ])('normalizeRouteTemplate(%j) === %j', (input, expected) => {
    expect(normalizeRouteTemplate(input as string)).toBe(expected)
  })

  it('never retains a query string or fragment', () => {
    expect(normalizeRouteTemplate('/s/share-token-abc?secret=hunter2#frag')).toBe('/s/:id')
    expect(normalizeRouteTemplate('/dashboard?vin=5YJ3E1EA7JF000316')).toBe('/dashboard')
    expect(normalizeRouteTemplate('/dashboard#lat=37.7')).toBe('/dashboard')
  })

  it('caps depth and length', () => {
    const deep = normalizeRouteTemplate('/a/b/c/d/e/f/g/h/i')
    expect(deep.split('/').length - 1).toBeLessThanOrEqual(MAX_ROUTE_SEGMENTS)

    const long = normalizeRouteTemplate(`/${'verylongsegment/'.repeat(10)}`)
    expect(long.length).toBeLessThanOrEqual(MAX_ROUTE_LENGTH)
  })

  it('exports the placeholder the backend expects', () => {
    expect(ID_PLACEHOLDER).toBe(':id')
  })
})

describe('routeTemplate — URL scrubbing in free text', () => {
  it('strips query and hash from absolute URLs', () => {
    expect(
      stripUrlQueryAndHash('failed at https://app.example.com/s/tok?secret=1#frag rest'),
    ).toBe('failed at https://app.example.com/s/tok rest')
  })

  it('leaves URL-free text untouched', () => {
    expect(stripUrlQueryAndHash('plain message')).toBe('plain message')
    expect(stripUrlQueryAndHash('')).toBe('')
  })

  it('templates OTHER absolute URLs, not just the current page', () => {
    // A static page can legitimately link to a different share URL. Templating
    // only `location` would leave that token intact all the way to the wire.
    const out = redactUrlsInText(
      'fetch failed for https://app.example.com/s/another-token?secret=1#frag',
    )
    expect(out).toBe('fetch failed for https://app.example.com/s/:id')
    expect(out).not.toContain('another-token')
  })

  it.each([
    ['absolute', 'https://app.example.com/s/another-token', 'https://app.example.com/s/:id'],
    ['protocol-relative', '//app.example.com/s/another-token', '//app.example.com/s/:id'],
    ['root-relative', '/s/another-token', '/s/:id'],
    ['root-relative with query', '/s/another-token?secret=1', '/s/:id'],
    ['root-relative with hash', '/s/another-token#frag', '/s/:id'],
    ['percent-encoded slug', '/s/%61nother-token', '/s/:id'],
    ['percent-encoded literal still resolves', '/year%2Dreview/2024', '/year-review/:id'],
    ['encoded slash is opaque', '/search/%2Fsecret', '/search/:id'],
    ['malformed encoding is opaque', '/search/%zz', '/search/:id'],
    ['truncated encoding is opaque', '/search/%2', '/search/:id'],
    ['numeric id', '/drives/48291', '/drives/:id'],
    ['known static route preserved', '/analytics/tco', '/analytics/tco'],
    ['known deep static route preserved', '/admin/telemetry/coverage', '/admin/telemetry/coverage'],
  ])('scrubs a %s URL', (_label, input, expected) => {
    expect(redactUrlsInText(`boom at ${input} end`)).toBe(`boom at ${expected} end`)
  })

  it('conservatively redacts opaque segments of UNKNOWN paths', () => {
    // No canonical route declares these parameters, so free-text scrubbing errs
    // towards redaction. Short structural words survive so the frame still says
    // which surface failed.
    expect(redactUrlsInText('GET /api/v1/vehicles/42 failed')).toBe(
      'GET /api/v1/vehicles/:id failed',
    )
    expect(redactUrlsInText('GET /unknown-root/customer-private-slug failed')).toBe(
      'GET /:id/:id failed',
    )
    expect(redactUrlsInText('GET /api/v1/some-private-slug failed')).toBe(
      'GET /api/v1/:id failed',
    )
  })

  it('keeps full fidelity in the ROUTE LABEL even where free text is conservative', () => {
    // The label needs to distinguish one analytics page from another; only the
    // free-text scrubber trades fidelity for caution.
    expect(normalizeRouteTemplate('/analytics/battery-degradation')).toBe(
      '/analytics/battery-degradation',
    )
    expect(redactUrlsInText('at /analytics/battery-degradation')).toBe('at /analytics/:id')
  })

  it('preserves build-artifact paths and their line:col suffix', () => {
    const frames = [
      'at foo (https://app.example.com/assets/index-abc123.js:1:2)',
      'at bar (/assets/vendor-9f8e7d.mjs:104:11)',
      'at baz (//cdn.example.com/assets/chunk-1a2b.css:3)',
      'at qux (https://app.example.com/assets/index-abc123.js.map:1:1)',
    ].join('\n')
    expect(redactUrlsInText(frames)).toBe(frames)
  })

  it('templates the PARENT directories of an asset, keeping only the filename', () => {
    // The asset carve-out must not extend to the directories above the file:
    // a share token can sit in a path segment with an index.html leaf.
    expect(redactUrlsInText('at /share/SECRETTOKENVALUE/index.html')).toBe(
      'at /share/:id/index.html',
    )
    expect(redactUrlsInText('at /s/tok-private-abc/main.js:1:2')).toBe(
      'at /s/:id/main.js:1:2',
    )
    expect(
      redactUrlsInText('at https://app.example.com/s/tok-private-abc/main.js:1:2'),
    ).toBe('at https://app.example.com/s/:id/main.js:1:2')
    expect(redactUrlsInText('at /trips/customer-private-slug/report.css')).toBe(
      'at /trips/:id/report.css',
    )
    // Unknown opaque directory, not a registry route.
    expect(redactUrlsInText('at /downloads/customer-private-slug/bundle.js:9:1')).toBe(
      'at /downloads/:id/bundle.js:9:1',
    )
    // A short structural directory survives, so the frame stays readable.
    expect(redactUrlsInText('at /assets/js/index-abc123.js:1:2')).toBe(
      'at /assets/js/index-abc123.js:1:2',
    )
    // Root-level asset: nothing above it to template.
    expect(redactUrlsInText('at /index.html:1:1')).toBe('at /index.html:1:1')
  })

  it('never leaks a token through an asset path in any spelling', () => {
    const inputs = [
      '/share/SECRETTOKENVALUE/index.html',
      'https://app.example.com/share/SECRETTOKENVALUE/index.html?x=1#y',
      '//cdn.example.com/share/SECRETTOKENVALUE/index.html',
      '/s/tok-private-abc/main.js:1:2',
    ]
    for (const input of inputs) {
      const out = redactUrlsInText(`boom at ${input}`)
      expect(out).not.toContain('SECRETTOKENVALUE')
      expect(out).not.toContain('tok-private-abc')
      expect(out).not.toContain('x=1')
      expect(out).not.toContain('#y')
    }
  })

  it('strips query and hash BEFORE locating the authority, so no-path URLs keep no params', () => {
    // Parsing the authority first reads `host?code=abc` as the authority and
    // `/x` as the path, silently retaining the parameter.
    expect(redactUrlsInText('boom at https://host?code=abc/x')).toBe('boom at https://host')
    expect(redactUrlsInText('boom at https://host#share=aa/bb')).toBe('boom at https://host')
    expect(redactUrlsInText('boom at //host?code=abc/x')).toBe('boom at //host')
    expect(redactUrlsInText('boom at //host#share=aa/bb')).toBe('boom at //host')
    expect(redactUrlsInText('boom at https://host?a=1')).toBe('boom at https://host')
    expect(redactUrlsInText('boom at https://host/?a=1')).toBe('boom at https://host/')
  })

  it('retains no query parameter whatever its name', () => {
    // The generic secret redactor only knows a fixed list of parameter names;
    // URL scrubbing must not depend on that list at all.
    for (const param of [
      'code',
      'share',
      'invite',
      'ref',
      'sig',
      'nonce',
      'utm_source',
      'anything_at_all',
    ]) {
      const out = redactUrlsInText(`boom at https://host?${param}=SECRETVALUE/x`)
      expect(out).toBe('boom at https://host')
      expect(out).not.toContain('SECRETVALUE')
      expect(out).not.toContain(param)
    }
  })

  it('preserves an authority port while dropping its query', () => {
    expect(redactUrlsInText('boom at https://host:8080')).toBe('boom at https://host:8080')
    expect(redactUrlsInText('boom at https://host:8080?code=abc')).toBe(
      'boom at https://host:8080',
    )
    expect(redactUrlsInText('boom at https://host:8080/s/tok-private-abc')).toBe(
      'boom at https://host:8080/s/:id',
    )
  })

  it('still strips query and hash from an asset URL', () => {
    expect(
      redactUrlsInText('at foo (https://app.example.com/assets/index-abc123.js?v=9#x:1:2)'),
    ).toBe('at foo (https://app.example.com/assets/index-abc123.js)')
  })

  it('does not treat an inner slash as a root-relative path', () => {
    expect(redactUrlsInText('ratio a/b/c stayed')).toBe('ratio a/b/c stayed')
    expect(redactUrlsInText('1/2/3')).toBe('1/2/3')
  })

  it('scrubs several URLs in one blob, including mixed forms', () => {
    const out = redactUrlsInText(
      [
        'GET https://app.example.com/s/token-one?k=v failed;',
        'retry //app.example.com/trips/token-two#frag;',
        'origin /automations/token-three/edit;',
        'frame at /assets/index-abc123.js:9:4',
      ].join(' '),
    )
    for (const token of ['token-one', 'token-two', 'token-three', 'k=v', '#frag']) {
      expect(out).not.toContain(token)
    }
    expect(out).toContain('/assets/index-abc123.js:9:4')
    expect(out).toContain('https://app.example.com/s/:id')
    expect(out).toContain('//app.example.com/trips/:id')
    expect(out).toContain('/automations/:id/edit')
  })

  it('replaces every spelling of the current location with its template', () => {
    const location = {
      href: 'https://app.example.com/s/share-token-abc?secret=hunter2#frag',
      pathname: '/s/share-token-abc',
      search: '?secret=hunter2',
      hash: '#frag',
    }
    const text = [
      'boom at https://app.example.com/s/share-token-abc?secret=hunter2#frag',
      'and at /s/share-token-abc?secret=hunter2#frag',
      'and at /s/share-token-abc?secret=hunter2',
      'and at /s/share-token-abc',
    ].join(' | ')

    const out = redactLocationInText(text, location)

    expect(out).not.toContain('share-token-abc')
    expect(out).not.toContain('hunter2')
    expect(out).not.toContain('#frag')
    expect(out.match(/\/s\/:id/g)).toHaveLength(4)
  })

  it('sweeps a current pathname that appears without a URL boundary', () => {
    const location = {
      href: 'https://app.example.com/s/share-token-abc',
      pathname: '/s/share-token-abc',
      search: '',
      hash: '',
    }
    const out = redactLocationInText('route=/s/share-token-abc?x=1 done', location)
    expect(out).not.toContain('share-token-abc')
    expect(out).not.toContain('x=1')
  })

  it('does not mangle unrelated stack frames', () => {
    const location = {
      href: 'https://app.example.com/dashboard',
      pathname: '/dashboard',
      search: '',
      hash: '',
    }
    const stack = 'at foo (https://app.example.com/assets/index-abc123.js:1:2)'
    expect(redactLocationInText(stack, location)).toBe(stack)
  })

  it('never treats a root pathname as a replaceable token', () => {
    const location = { href: 'https://app.example.com/', pathname: '/', search: '', hash: '' }
    expect(redactLocationInText('a/b/c', location)).toBe('a/b/c')
  })

  it('works with no location at all (pre-DOM boot)', () => {
    const out = redactLocationInText('boom at https://app.example.com/s/tok?x=1#y', undefined)
    expect(out).toBe('boom at https://app.example.com/s/:id')
  })
})

describe('routeTemplate — safe percent-decoding', () => {
  it.each([
    ['plain segment', 'dashboard', { value: 'dashboard', opaque: false }],
    ['encoded hyphen', 'year%2Dreview', { value: 'year-review', opaque: false }],
    ['encoded slash', '%2Fsecret', { value: '%2Fsecret', opaque: true }],
    ['encoded backslash', '%5Cshare', { value: '%5Cshare', opaque: true }],
    ['malformed', '%zz', { value: '%zz', opaque: true }],
    ['truncated', '%2', { value: '%2', opaque: true }],
  ])('safeDecodeSegment(%s)', (_label, input, expected) => {
    expect(safeDecodeSegment(input as string)).toEqual(expected)
  })

  it('never emits a percent-encoding in a template', () => {
    for (const input of [
      '/search/%2Fsecret',
      '/search/%zz',
      '/search/%2',
      '/s/%61nother-token',
      '/year%2Dreview/2024',
    ]) {
      expect(normalizeRouteTemplate(input)).not.toContain('%')
    }
  })
})
