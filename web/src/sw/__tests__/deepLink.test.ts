import { describe, expect, it } from 'vitest'

import {
  ALLOWED_DEEP_LINK_PATTERNS,
  NOTIFICATION_FALLBACK_URL,
  sanitizeNotificationUrl,
} from '../deepLink'

/**
 * Notification deep-link sanitisation (PWA-06).
 *
 * `data.url` arrives over the push channel and is handed to
 * `WindowClient.navigate()`. That makes it an open-redirect sink reachable by
 * anything that can enqueue a push for this subscription, so the tests below
 * are written as an attack list first and a happy path second.
 */

const ORIGIN = 'https://teslasync.example'

const sanitize = (raw: unknown) => sanitizeNotificationUrl(raw, ORIGIN)

describe('rejected inputs fall back to the inbox', () => {
  it.each([
    ['a foreign absolute URL', 'https://evil.example/steal'],
    ['a protocol-relative URL', '//evil.example/steal'],
    ['a backslash-smuggled origin', '/\\evil.example/steal'],
    ['a javascript: URL', 'javascript:fetch("/api/v1/settings")'],
    ['an uppercase javascript: URL', 'JavaScript:alert(1)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['a blob: URL', 'blob:https://teslasync.example/abc'],
    ['a file: URL', 'file:///etc/passwd'],
    ['an unknown route', '/definitely-not-a-route'],
    ['an admin route that is not on the allowlist', '/admin/secret-rotation'],
    ['a settings route', '/settings/integrations'],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a newline injection', '/vehicles\n/evil'],
    ['a null byte', '/vehicles\u0000'],
    ['a non-string', 42],
    ['undefined', undefined],
    ['null', null],
    ['an object', { url: '/vehicles' }],
  ])('rejects %s', (_label, raw) => {
    const result = sanitize(raw)
    expect(result.url).toBe(NOTIFICATION_FALLBACK_URL)
    expect(result.accepted).toBe(false)
    expect(result.rejection).not.toBeNull()
  })

  it('records why it rejected, for diagnostics', () => {
    expect(sanitize('https://evil.example/x').rejection).toBe('foreign-origin')
    expect(sanitize('javascript:alert(1)').rejection).toBe('unsupported-scheme')
    expect(sanitize('/nope').rejection).toBe('route-not-allowlisted')
    expect(sanitize(7).rejection).toBe('not-a-string')
  })
})

describe('accepted deep links', () => {
  it.each([
    '/',
    '/vehicles',
    '/vehicles/12',
    '/vehicles/12/access',
    '/drives/440',
    '/drives/440/replay',
    '/charging/9',
    '/data-repair',
    '/notifications/inbox',
    '/notifications/alerts',
    '/action-center',
  ])('accepts the exact route %s', (path) => {
    const result = sanitize(path)
    expect(result.accepted).toBe(true)
    expect(result.url).toBe(path)
  })

  it('accepts a same-origin absolute URL and reduces it to a path', () => {
    expect(sanitize(`${ORIGIN}/drives/7`).url).toBe('/drives/7')
  })

  it('normalises a trailing slash but keeps the site root', () => {
    expect(sanitize('/vehicles/3/').url).toBe('/vehicles/3')
    expect(sanitize('/').url).toBe('/')
  })

  it('rejects a non-numeric or zero id in a parameterised route', () => {
    expect(sanitize('/vehicles/abc').accepted).toBe(false)
    expect(sanitize('/vehicles/0').accepted).toBe(false)
    expect(sanitize('/drives/-1').accepted).toBe(false)
  })
})

describe('query-parameter allowlist', () => {
  it('keeps the vetted context parameters', () => {
    const result = sanitize('/notifications/alerts?alert=42&vehicle_id=3&signal=BatteryLevel')
    expect(result.accepted).toBe(true)
    expect(result.url).toBe('/notifications/alerts?alert=42&vehicle_id=3&signal=BatteryLevel')
    expect(result.droppedParams).toEqual([])
  })

  it('keeps a valid ISO instant for chart centring', () => {
    const result = sanitize('/battery?t=2026-08-26T14:02:00Z')
    expect(result.url).toBe('/battery?t=2026-08-26T14%3A02%3A00Z')
  })

  it('drops every open-redirect carrier', () => {
    const result = sanitize(
      '/notifications/inbox?redirect=https://evil.example&next=/x&return_to=/y&url=z',
    )
    expect(result.url).toBe('/notifications/inbox')
    expect(result.droppedParams).toEqual(['redirect', 'next', 'return_to', 'url'])
  })

  it('drops parameters that fail their own validator', () => {
    const result = sanitize('/data-repair?case=not-a-number&event=0&signal=has spaces')
    expect(result.url).toBe('/data-repair')
    expect(result.droppedParams).toEqual(['case', 'event', 'signal'])
  })

  it('drops the fragment entirely', () => {
    expect(sanitize('/vehicles/5#<img src=x onerror=alert(1)>').url).toBe('/vehicles/5')
  })

  it('keeps only the first occurrence of a repeated parameter', () => {
    const result = sanitize('/data-repair?case=1&case=2')
    expect(result.url).toBe('/data-repair?case=1')
    expect(result.droppedParams).toEqual(['case'])
  })
})

describe('allowlist hygiene', () => {
  it('contains only absolute paths', () => {
    for (const pattern of ALLOWED_DEEP_LINK_PATTERNS) {
      expect(pattern.startsWith('/')).toBe(true)
    }
  })

  it('names the fallback as one of its own allowed routes', () => {
    expect(ALLOWED_DEEP_LINK_PATTERNS).toContain(NOTIFICATION_FALLBACK_URL)
  })
})
