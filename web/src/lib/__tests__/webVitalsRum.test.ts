import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Metric } from 'web-vitals'

// Capture the callbacks registered with web-vitals so the tests can invoke
// them with synthetic metrics.
const registeredCallbacks: Record<string, ((m: Metric) => void) | undefined> = {}

vi.mock('web-vitals', () => {
  const register = (name: string) => (cb: (m: Metric) => void) => {
    registeredCallbacks[name] = cb
  }
  return {
    onLCP: register('LCP'),
    onINP: register('INP'),
    onCLS: register('CLS'),
    onFCP: register('FCP'),
    onTTFB: register('TTFB'),
  }
})

import {
  __resetWebVitalsReporterForTests,
  collectReporterContext,
  currentNavigationToken,
  flush,
  getConnectionClass,
  getDeviceClass,
  getRelease,
  getThemeClass,
  markContentReady,
  markNavigationStart,
  normalizeRouteTemplate,
  reportRouteTransition,
  reportTimeToUsableContent,
  reportUxEvent,
  startWebVitalsReporter,
  UX_EVENT_KINDS,
  UX_EVENT_OUTCOMES,
  type NavigationToken,
  type ReporterContext,
  type UxEventPayload,
  type VitalsPayload,
} from '../webVitalsReporter'
import { setVitalsConsentRequirement } from '../webVitalsConsent'
import { setConsent, clearConsent } from '../cookieConsent'

interface SentBatch {
  context: ReporterContext
  metrics: VitalsPayload[]
  events?: UxEventPayload[]
}

function makeMetric(overrides: Partial<Metric> = {}): Metric {
  return {
    name: 'LCP',
    value: 1234,
    id: 'v3-1234',
    rating: 'good',
    delta: 1234,
    entries: [],
    navigationType: 'navigate',
    ...overrides,
  } as Metric
}

describe('webVitalsReporter — route template normalisation (privacy)', () => {
  it.each([
    ['', '/'],
    ['/', '/'],
    ['/Dashboard', '/dashboard'],
    ['/drives/123', '/drives/:id'],
    ['/drives/123/telemetry', '/drives/:id/telemetry'],
    ['/charging/9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d', '/charging/:id'],
    ['/vehicles/5YJ3E1EA7JF000316', '/vehicles/:id'],
    ['/vehicles/5yj3e1ea7jf000316', '/vehicles/:id'],
    ['/map/37.7749,-122.4194', '/map/:id'],
    ['/map/37.7749', '/map/:id'],
    ['/user/jane.doe@example.com', '/user/:id'],
    ['/search/%2Fsecret', '/search/:id'],
    ['/share/aB3xQ9zL2mK7', '/share/:id'],
    ['/share/abcdef0123456789abcdef', '/share/:id'],
    ['/dashboard?vin=5YJ3E1EA7JF000316', '/dashboard'],
    ['/dashboard#lat=37.7', '/dashboard'],
    ['https://tenant.example.com/dashboard', '/dashboard'],
    ['dashboard', '/dashboard'],
    ['/dashboard/', '/dashboard'],
    ['/a//b', '/a/b'],
    ['/analytics/battery-degradation', '/analytics/battery-degradation'],
    ['/vehicles/list/state', '/vehicles/list/state'],
    ['/search/Berlin Straße', '/search/:id'],
  ])('normalizeRouteTemplate(%j) === %j', (input, expected) => {
    expect(normalizeRouteTemplate(input as string)).toBe(expected)
  })

  it('caps route depth and label length', () => {
    const deep = normalizeRouteTemplate('/a/b/c/d/e/f/g/h/i')
    expect(deep.split('/').length - 1).toBeLessThanOrEqual(6)

    const long = normalizeRouteTemplate(`/${'verylongsegment/'.repeat(10)}`)
    expect(long.length).toBeLessThanOrEqual(50)
  })

  it('never leaks entity IDs, VINs, coordinates or e-mails', () => {
    const inputs = [
      '/drives/48291/telemetry',
      '/vehicles/5YJ3E1EA7JF000316/battery',
      '/share/6f1a4c2b9e8d7f0a1b2c3d4e5f60718293a4b5c6',
      '/user/ops@example.com/settings',
      '/map/37.774900,-122.419400',
    ]
    for (const input of inputs) {
      const out = normalizeRouteTemplate(input)
      expect(out).not.toMatch(/\d{4,}/)
      expect(out).not.toContain('@')
    }
  })
})

describe('webVitalsReporter — bounded dimensions', () => {
  const originalInnerWidth = window.innerWidth

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {
      value: originalInnerWidth,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(navigator, 'connection', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    document.documentElement.classList.remove('dark', 'light-mode', 'light')
  })

  function setWidth(width: number): void {
    Object.defineProperty(window, 'innerWidth', {
      value: width,
      configurable: true,
      writable: true,
    })
  }

  it('classifies device by viewport width only (no UA fingerprinting)', () => {
    setWidth(400)
    expect(getDeviceClass()).toBe('mobile')
    setWidth(800)
    expect(getDeviceClass()).toBe('tablet')
    setWidth(1600)
    expect(getDeviceClass()).toBe('desktop')
  })

  it('maps effectiveType onto the closed connection set', () => {
    const set = (effectiveType: unknown) =>
      Object.defineProperty(navigator, 'connection', {
        value: { effectiveType },
        configurable: true,
        writable: true,
      })

    set('4g')
    expect(getConnectionClass()).toBe('4g')
    set('SLOW-2G')
    expect(getConnectionClass()).toBe('slow-2g')
    set('6g')
    expect(getConnectionClass()).toBe('unknown')
    set(undefined)
    expect(getConnectionClass()).toBe('unknown')

    Object.defineProperty(navigator, 'connection', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    expect(getConnectionClass()).toBe('unknown')
  })

  it('reads theme from the documentElement class list', () => {
    expect(getThemeClass()).toBe('unknown')
    document.documentElement.classList.add('dark')
    expect(getThemeClass()).toBe('dark')
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light-mode')
    expect(getThemeClass()).toBe('light')
  })

  it('produces a release label that is safe to use as a Prometheus label', () => {
    const release = getRelease()
    expect(release).toMatch(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/)
    expect(release.length).toBeLessThanOrEqual(32)
  })

  it('collects only the four bounded dimensions', () => {
    expect(Object.keys(collectReporterContext()).sort()).toEqual([
      'connection',
      'device',
      'release',
      'theme',
    ])
  })
})

describe('webVitalsReporter — payload, navigation and UX events', () => {
  let beacon: ReturnType<typeof vi.fn>
  let originalSendBeacon: typeof navigator.sendBeacon | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    Object.keys(registeredCallbacks).forEach(k => delete registeredCallbacks[k])
    __resetWebVitalsReporterForTests()

    originalSendBeacon = navigator.sendBeacon
    beacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', {
      value: beacon,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/drives/4711' },
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(navigator, 'sendBeacon', {
      value: originalSendBeacon,
      configurable: true,
      writable: true,
    })
    __resetWebVitalsReporterForTests()
  })

  async function lastBatch(): Promise<SentBatch> {
    const call = beacon.mock.calls[beacon.mock.calls.length - 1]
    const text = await (call[1] as Blob).text()
    return JSON.parse(text) as SentBatch
  }

  it('ships the bounded context alongside every batch', async () => {
    startWebVitalsReporter()
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500 }))
    await vi.advanceTimersByTimeAsync(2_000)

    const batch = await lastBatch()
    expect(batch.context).toBeDefined()
    expect(Object.keys(batch.context).sort()).toEqual([
      'connection',
      'device',
      'release',
      'theme',
    ])
  })

  it('normalises the route before it leaves the browser', async () => {
    startWebVitalsReporter()
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500 }))
    await vi.advanceTimersByTimeAsync(2_000)

    const batch = await lastBatch()
    expect(batch.metrics[0].route).toBe('/drives/:id')
    expect(JSON.stringify(batch)).not.toContain('4711')
  })

  it('reports route paint and explicit time-to-usable-content', async () => {
    startWebVitalsReporter()
    reportRouteTransition(340, '/drives/4711')
    reportTimeToUsableContent(1800, '/drives/4711')
    await vi.advanceTimersByTimeAsync(2_000)

    const batch = await lastBatch()
    const byName = Object.fromEntries(batch.metrics.map(m => [m.name, m]))
    expect(byName.RouteChange.value).toBe(340)
    expect(byName.RouteChange.rating).toBe('needs-improvement')
    expect(byName.RouteChange.route).toBe('/drives/:id')
    expect(byName.TTUC.value).toBe(1800)
    expect(byName.TTUC.rating).toBe('good')
  })

  it('never auto-completes TTUC — a URL change alone proves nothing about usability', async () => {
    startWebVitalsReporter()
    history.pushState({}, '', '/charging')
    await vi.advanceTimersByTimeAsync(2_100)

    const batch = await lastBatch()
    expect(batch.metrics.some(m => m.name === 'RouteChange')).toBe(true)
    expect(batch.metrics.some(m => m.name === 'TTUC')).toBe(false)
  })

  it('emits at most one TTUC per navigation', async () => {
    startWebVitalsReporter()
    const token = markNavigationStart('/dashboard')
    expect(markContentReady(token)).toBe(true)
    expect(markContentReady(token)).toBe(false)
    expect(markContentReady(token)).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)

    const batch = await lastBatch()
    expect(batch.metrics.filter(m => m.name === 'TTUC')).toHaveLength(1)
  })

  it('re-arms TTUC on the next navigation', async () => {
    startWebVitalsReporter()
    const a = markNavigationStart('/dashboard')
    markContentReady(a)
    const b = markNavigationStart('/charging')
    markContentReady(b)
    await vi.advanceTimersByTimeAsync(2_000)

    const batch = await lastBatch()
    const ttuc = batch.metrics.filter(m => m.name === 'TTUC')
    expect(ttuc).toHaveLength(2)
    expect(ttuc.map(m => m.route)).toEqual(['/dashboard', '/charging'])
  })

  it('measures a history.pushState transition without any router wiring', async () => {
    startWebVitalsReporter()
    history.pushState({}, '', '/charging')
    await vi.advanceTimersByTimeAsync(2_100)

    const batch = await lastBatch()
    expect(batch.metrics.some(m => m.name === 'RouteChange')).toBe(true)
  })

  it('queues UX events from the closed sets', async () => {
    startWebVitalsReporter()
    reportUxEvent({ kind: 'query', outcome: 'failure', route: '/drives/4711' })
    reportUxEvent({ kind: 'cache', outcome: 'hit', route: '/dashboard', count: 3 })
    await vi.advanceTimersByTimeAsync(2_000)

    const batch = await lastBatch()
    expect(batch.events).toHaveLength(2)
    expect(batch.events![0]).toEqual({
      kind: 'query',
      outcome: 'failure',
      route: '/drives/:id',
      count: 1,
    })
    expect(batch.events![1].count).toBe(3)
  })

  it('drops UX events outside the closed sets', async () => {
    startWebVitalsReporter()
    reportUxEvent({
      kind: 'exfiltrate' as UxEventPayload['kind'],
      outcome: 'success',
      route: '/dashboard',
    })
    reportUxEvent({
      kind: 'query',
      outcome: 'weird' as UxEventPayload['outcome'],
      route: '/dashboard',
    })
    reportUxEvent({ kind: 'retry', outcome: 'retried', route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(2_000)

    const batch = await lastBatch()
    expect(batch.events).toHaveLength(1)
    expect(batch.events![0].kind).toBe('retry')
  })

  it('clamps the UX event count into the server-accepted range', async () => {
    startWebVitalsReporter()
    reportUxEvent({ kind: 'retry', outcome: 'retried', route: '/a', count: 10_000 })
    reportUxEvent({ kind: 'retry', outcome: 'retried', route: '/b', count: -5 })
    await vi.advanceTimersByTimeAsync(2_000)

    const batch = await lastBatch()
    expect(batch.events![0].count).toBe(1000)
    expect(batch.events![1].count).toBe(1)
  })

  it('chunks oversized queues to the server per-request ceiling', async () => {
    startWebVitalsReporter()
    for (let i = 0; i < 250; i++) {
      registeredCallbacks.CLS!(makeMetric({ name: 'CLS', value: 0.01, id: `cls-${i}` }))
    }
    await vi.advanceTimersByTimeAsync(2_000)

    expect(beacon.mock.calls.length).toBeGreaterThanOrEqual(3)
    for (const call of beacon.mock.calls) {
      const parsed = JSON.parse(await (call[1] as Blob).text()) as SentBatch
      expect(parsed.metrics.length).toBeLessThanOrEqual(100)
      expect((parsed.events ?? []).length).toBeLessThanOrEqual(100)
    }
  })

  it('drops non-finite and negative metric values before they are queued', async () => {
    startWebVitalsReporter()
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: Number.NaN }))
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: -1 }))
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 900 }))
    await vi.advanceTimersByTimeAsync(2_000)

    const batch = await lastBatch()
    expect(batch.metrics).toHaveLength(1)
    expect(batch.metrics[0].value).toBe(900)
  })

  it('captures failed sub-resource loads as a bounded UX event without the URL', async () => {
    startWebVitalsReporter()

    const img = document.createElement('img')
    document.body.appendChild(img)
    img.dispatchEvent(new Event('error', { bubbles: false }))
    document.body.removeChild(img)

    await vi.advanceTimersByTimeAsync(2_000)

    const batch = await lastBatch()
    const resourceEvents = (batch.events ?? []).filter(e => e.kind === 'resource')
    expect(resourceEvents).toHaveLength(1)
    expect(resourceEvents[0]).toEqual({
      kind: 'resource',
      outcome: 'failure',
      route: '/drives/:id',
      count: 1,
    })
    // The failing asset URL must never travel — only the bounded triple.
    expect(Object.keys(resourceEvents[0]).sort()).toEqual([
      'count',
      'kind',
      'outcome',
      'route',
    ])
  })

  it('ignores window-level script errors in the resource listener', async () => {
    startWebVitalsReporter()
    window.dispatchEvent(new Event('error'))
    reportUxEvent({ kind: 'user_action', outcome: 'success', route: '/dashboard' })
    await vi.advanceTimersByTimeAsync(2_000)

    const batch = await lastBatch()
    expect((batch.events ?? []).filter(e => e.kind === 'resource')).toHaveLength(0)
  })

  it('does not send when both queues are empty', async () => {
    startWebVitalsReporter()
    await flush()
    expect(beacon).not.toHaveBeenCalled()
  })

  it('keeps the closed sets in sync with the documented contract', () => {
    expect([...UX_EVENT_KINDS]).toEqual([
      'error',
      'resource',
      'query',
      'retry',
      'cache',
      'cancellation',
      'user_action',
    ])
    expect([...UX_EVENT_OUTCOMES]).toEqual([
      'success',
      'failure',
      'hit',
      'miss',
      'timeout',
      'cancelled',
      'blocked',
      'retried',
    ])
  })
})

describe('webVitalsReporter — rapid navigation (tokenized, immutable)', () => {
  let beacon: ReturnType<typeof vi.fn>
  let originalSendBeacon: typeof navigator.sendBeacon | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    Object.keys(registeredCallbacks).forEach(k => delete registeredCallbacks[k])
    __resetWebVitalsReporterForTests()
    originalSendBeacon = navigator.sendBeacon
    beacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', {
      value: beacon,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(navigator, 'sendBeacon', {
      value: originalSendBeacon,
      configurable: true,
      writable: true,
    })
    __resetWebVitalsReporterForTests()
  })

  async function lastBatch(): Promise<SentBatch> {
    const call = beacon.mock.calls[beacon.mock.calls.length - 1]
    return JSON.parse(await (call[1] as Blob).text()) as SentBatch
  }

  // jsdom's history does not drive `window.location` for our stubbed object,
  // so the specs move the pathname explicitly to model a real navigation.
  function setPath(pathname: string): void {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname },
      configurable: true,
    })
  }

  it('mints an immutable token per navigation', () => {
    startWebVitalsReporter()
    const a = markNavigationStart('/alpha')
    const b = markNavigationStart('/beta')

    expect(a.id).not.toBe(b.id)
    expect(b.id).toBeGreaterThan(a.id)
    expect(a.route).toBe('/alpha')
    expect(Object.isFrozen(a)).toBe(true)
    // Mutating a token must not change it (frozen) and must not affect state.
    expect(() => {
      const mutable = a as { route: string }
      mutable.route = '/hacked'
    }).toThrow()
    expect(a.route).toBe('/alpha')
    expect(currentNavigationToken().id).toBe(b.id)
  })

  it('ignores markContentReady for a superseded navigation', async () => {
    startWebVitalsReporter()
    const stale = markNavigationStart('/alpha')
    markNavigationStart('/beta')

    // /alpha's data finally arrives — but the user is on /beta now.
    expect(markContentReady(stale)).toBe(false)

    const live = currentNavigationToken()
    expect(markContentReady(live)).toBe(true)

    await vi.advanceTimersByTimeAsync(2_000)
    const batch = await lastBatch()
    const ttuc = batch.metrics.filter(m => m.name === 'TTUC')
    expect(ttuc).toHaveLength(1)
    expect(ttuc[0].route).toBe('/beta')
  })

  it('does not let an older navigation complete a newer one', async () => {
    startWebVitalsReporter()
    const first = markNavigationStart('/alpha')
    const second = markNavigationStart('/beta')
    const third = markNavigationStart('/gamma')

    expect(markContentReady(first)).toBe(false)
    expect(markContentReady(second)).toBe(false)
    expect(markContentReady(third)).toBe(true)

    await vi.advanceTimersByTimeAsync(2_000)
    const batch = await lastBatch()
    const ttuc = batch.metrics.filter(m => m.name === 'TTUC')
    expect(ttuc).toHaveLength(1)
    expect(ttuc[0].route).toBe('/gamma')
  })

  it('discards route-paint samples for navigations superseded before paint', async () => {
    setPath('/start')
    startWebVitalsReporter()
    // Three pushes inside one frame: only the last is still live when the
    // double-rAF callbacks run.
    setPath('/alpha')
    history.pushState({}, '', '/alpha')
    setPath('/beta')
    history.pushState({}, '', '/beta')
    setPath('/gamma')
    history.pushState({}, '', '/gamma')

    await vi.advanceTimersByTimeAsync(2_100)

    const batch = await lastBatch()
    const paints = batch.metrics.filter(m => m.name === 'RouteChange')
    expect(paints).toHaveLength(1)
    expect(paints[0].route).toBe('/gamma')
  })

  it('attributes a popstate transition to the route that was live at start', async () => {
    setPath('/start')
    startWebVitalsReporter()
    setPath('/charging')
    window.dispatchEvent(new Event('popstate'))
    // The user keeps browsing before the previous transition painted.
    setPath('/drives/99')
    window.dispatchEvent(new Event('popstate'))

    await vi.advanceTimersByTimeAsync(2_100)

    const batch = await lastBatch()
    const paints = batch.metrics.filter(m => m.name === 'RouteChange')
    expect(paints).toHaveLength(1)
    expect(paints[0].route).toBe('/drives/:id')
  })

  it('rejects a malformed token instead of guessing', () => {
    startWebVitalsReporter()
    markNavigationStart('/alpha')
    expect(markContentReady(undefined as unknown as NavigationToken)).toBe(false)
    expect(markContentReady({} as NavigationToken)).toBe(false)
    expect(markContentReady({ id: 999, route: '/x', startedAt: 0 })).toBe(false)
  })
})

describe('webVitalsReporter — consent gate fails closed', () => {
  let beacon: ReturnType<typeof vi.fn>
  let originalSendBeacon: typeof navigator.sendBeacon | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    Object.keys(registeredCallbacks).forEach(k => delete registeredCallbacks[k])
    localStorage.clear()
    clearConsent()
    originalSendBeacon = navigator.sendBeacon
    beacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', {
      value: beacon,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    Object.defineProperty(navigator, 'sendBeacon', {
      value: originalSendBeacon,
      configurable: true,
      writable: true,
    })
    __resetWebVitalsReporterForTests()
  })

  it('HOLDS the queue while the deployment policy is unknown', async () => {
    __resetWebVitalsReporterForTests('unknown')
    startWebVitalsReporter()
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500 }))

    await vi.advanceTimersByTimeAsync(10_000)

    expect(beacon).not.toHaveBeenCalled()
  })

  it('delivers the held queue once the policy resolves to not-required', async () => {
    __resetWebVitalsReporterForTests('unknown')
    startWebVitalsReporter()
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500, id: 'held-lcp' }))
    registeredCallbacks.FCP!(makeMetric({ name: 'FCP', value: 700, id: 'held-fcp' }))
    await vi.advanceTimersByTimeAsync(4_000)
    expect(beacon).not.toHaveBeenCalled()

    // /system/version resolves: consent is not required in this install.
    setVitalsConsentRequirement(false)
    await vi.advanceTimersByTimeAsync(0)

    expect(beacon).toHaveBeenCalledTimes(1)
    const batch = JSON.parse(
      await (beacon.mock.calls[0][1] as Blob).text(),
    ) as SentBatch
    expect(batch.metrics.map(m => m.id).sort()).toEqual(['held-fcp', 'held-lcp'])
  })

  it('DROPS the queue when consent is required and not granted', async () => {
    __resetWebVitalsReporterForTests('unknown')
    startWebVitalsReporter()
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500 }))
    await vi.advanceTimersByTimeAsync(4_000)

    setVitalsConsentRequirement(true) // consent state is still 'unknown'
    await vi.advanceTimersByTimeAsync(4_000)

    expect(beacon).not.toHaveBeenCalled()

    // A later Accept must NOT back-flush the pre-consent samples.
    setConsent('accepted')
    await vi.advanceTimersByTimeAsync(4_000)
    expect(beacon).not.toHaveBeenCalled()

    // New samples collected under the accepted basis do go out.
    registeredCallbacks.INP!(makeMetric({ name: 'INP', value: 120, id: 'post-consent' }))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(beacon).toHaveBeenCalledTimes(1)
    const batch = JSON.parse(
      await (beacon.mock.calls[0][1] as Blob).text(),
    ) as SentBatch
    expect(batch.metrics.map(m => m.id)).toEqual(['post-consent'])
  })

  it('never sends when the user declined', async () => {
    __resetWebVitalsReporterForTests('required')
    setConsent('declined')
    startWebVitalsReporter()
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500 }))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(beacon).not.toHaveBeenCalled()
  })
})

describe('webVitalsReporter — consent transition races', () => {
  let beacon: ReturnType<typeof vi.fn>
  let originalSendBeacon: typeof navigator.sendBeacon | undefined

  beforeEach(() => {
    vi.useFakeTimers()
    Object.keys(registeredCallbacks).forEach(k => delete registeredCallbacks[k])
    localStorage.clear()
    clearConsent()
    originalSendBeacon = navigator.sendBeacon
    beacon = vi.fn(() => true)
    Object.defineProperty(navigator, 'sendBeacon', {
      value: beacon,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    clearConsent()
    Object.defineProperty(navigator, 'sendBeacon', {
      value: originalSendBeacon,
      configurable: true,
      writable: true,
    })
    __resetWebVitalsReporterForTests()
  })

  async function sentIds(): Promise<string[]> {
    const ids: string[] = []
    for (const call of beacon.mock.calls) {
      const batch = JSON.parse(await (call[1] as Blob).text()) as SentBatch
      ids.push(...batch.metrics.map(m => m.id))
    }
    return ids
  }

  it('hold -> accept: samples queued before the accept never cross it', async () => {
    // Policy unresolved, so the queue is HELD (not dropped).
    __resetWebVitalsReporterForTests('unknown')
    startWebVitalsReporter()
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500, id: 'pre-accept' }))
    await vi.advanceTimersByTimeAsync(4_000)
    expect(beacon).not.toHaveBeenCalled()

    // The user accepts while we are still holding. The queue must be discarded
    // SYNCHRONOUSLY — before any later flush can observe a permissive gate.
    setConsent('accepted')

    // The policy then resolves to a value that would authorise sending.
    setVitalsConsentRequirement(false)
    await vi.advanceTimersByTimeAsync(4_000)

    expect(await sentIds()).not.toContain('pre-accept')

    registeredCallbacks.INP!(makeMetric({ name: 'INP', value: 120, id: 'post-accept' }))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await sentIds()).toEqual(['post-accept'])
  })

  it('declined -> accept before the flush timer: nothing pre-accept is sent', async () => {
    __resetWebVitalsReporterForTests('required')
    setConsent('declined')
    startWebVitalsReporter()

    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500, id: 'while-declined' }))
    // Deliberately do NOT advance the timer — the samples are still queued.
    expect(beacon).not.toHaveBeenCalled()

    setConsent('accepted')
    // Synchronous purge: a flush right now must find nothing.
    await flush()
    expect(beacon).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(4_000)
    expect(await sentIds()).not.toContain('while-declined')

    registeredCallbacks.FCP!(makeMetric({ name: 'FCP', value: 700, id: 'after-accept' }))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await sentIds()).toEqual(['after-accept'])
  })

  it('accept -> decline before the flush timer: queued samples are discarded', async () => {
    __resetWebVitalsReporterForTests('required')
    setConsent('accepted')
    startWebVitalsReporter()

    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500, id: 'while-accepted' }))
    expect(beacon).not.toHaveBeenCalled()

    setConsent('declined')
    await flush()
    await vi.advanceTimersByTimeAsync(4_000)

    expect(beacon).not.toHaveBeenCalled()
  })

  it('pagehide race: an unresolved policy sends nothing on unload', async () => {
    __resetWebVitalsReporterForTests('unknown')
    startWebVitalsReporter()
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500, id: 'unload-hold' }))

    window.dispatchEvent(new Event('pagehide'))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    expect(beacon).not.toHaveBeenCalled()
  })

  it('pagehide race: required + no answer sends nothing on unload', async () => {
    __resetWebVitalsReporterForTests('required')
    startWebVitalsReporter()
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500, id: 'unload-drop' }))

    window.dispatchEvent(new Event('pagehide'))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    expect(beacon).not.toHaveBeenCalled()
  })

  it('pagehide race: accepting then unloading ships only post-accept samples', async () => {
    __resetWebVitalsReporterForTests('required')
    startWebVitalsReporter()
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500, id: 'pre-accept' }))

    setConsent('accepted')
    registeredCallbacks.INP!(makeMetric({ name: 'INP', value: 90, id: 'post-accept' }))

    window.dispatchEvent(new Event('pagehide'))
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)

    expect(await sentIds()).toEqual(['post-accept'])
  })

  it('discards queued UX events across a consent transition too', async () => {
    __resetWebVitalsReporterForTests('unknown')
    startWebVitalsReporter()
    reportUxEvent({ kind: 'query', outcome: 'failure', route: '/dashboard' })

    setConsent('accepted')
    setVitalsConsentRequirement(false)
    await vi.advanceTimersByTimeAsync(4_000)

    expect(beacon).not.toHaveBeenCalled()
  })

  it('a repeated consent write with no change does not discard the queue', async () => {
    __resetWebVitalsReporterForTests('required')
    setConsent('accepted')
    startWebVitalsReporter()

    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500, id: 'keep-me' }))
    // Same value written again — no transition, so nothing is discarded.
    setConsent('accepted')
    await vi.advanceTimersByTimeAsync(2_000)

    expect(await sentIds()).toEqual(['keep-me'])
  })
})
