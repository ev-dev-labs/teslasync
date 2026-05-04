import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Metric } from 'web-vitals'

// Capture the callbacks registered with web-vitals so the tests can
// invoke them with synthetic metrics. Each on*-function stores the most
// recently registered callback in `registeredCallbacks` keyed by name.
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

// Imported AFTER the mock above so the reporter sees the mocked module.
import {
  startWebVitalsReporter,
  flush,
  __resetWebVitalsReporterForTests,
  type VitalsPayload,
} from '../webVitalsReporter'

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

describe('webVitalsReporter', () => {
  let originalSendBeacon: typeof navigator.sendBeacon | undefined
  let originalFetch: typeof globalThis.fetch | undefined
  let beacon: ReturnType<typeof vi.fn>
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    Object.keys(registeredCallbacks).forEach(k => delete registeredCallbacks[k])
    __resetWebVitalsReporterForTests()

    originalSendBeacon = navigator.sendBeacon
    originalFetch = globalThis.fetch
    beacon = vi.fn(() => true)
    fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    Object.defineProperty(navigator, 'sendBeacon', {
      value: beacon,
      configurable: true,
      writable: true,
    })
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch

    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/dashboard' },
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalSendBeacon === undefined) {
      // jsdom doesn't ship sendBeacon by default — restore "undefined" so
      // the next test's beforeEach gets a clean slate.
      Object.defineProperty(navigator, 'sendBeacon', {
        value: undefined,
        configurable: true,
        writable: true,
      })
    } else {
      Object.defineProperty(navigator, 'sendBeacon', {
        value: originalSendBeacon,
        configurable: true,
        writable: true,
      })
    }
    if (originalFetch === undefined) {
      delete (globalThis as { fetch?: typeof globalThis.fetch }).fetch
    } else {
      globalThis.fetch = originalFetch
    }
  })

  it('registers callbacks for LCP, INP, CLS, FCP, and TTFB', () => {
    startWebVitalsReporter()
    expect(registeredCallbacks.LCP).toBeTypeOf('function')
    expect(registeredCallbacks.INP).toBeTypeOf('function')
    expect(registeredCallbacks.CLS).toBeTypeOf('function')
    expect(registeredCallbacks.FCP).toBeTypeOf('function')
    expect(registeredCallbacks.TTFB).toBeTypeOf('function')
  })

  it('is idempotent — registering twice does not double-register', () => {
    startWebVitalsReporter()
    const firstLCP = registeredCallbacks.LCP
    // Replace registered callback with sentinel; second start should not
    // overwrite it because the reporter early-returns when already started.
    const sentinel = vi.fn()
    registeredCallbacks.LCP = sentinel
    startWebVitalsReporter()
    expect(registeredCallbacks.LCP).toBe(sentinel)
    expect(firstLCP).not.toBe(sentinel)
  })

  it('coalesces metrics into a single batch and ships via sendBeacon', async () => {
    startWebVitalsReporter()

    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500, id: 'lcp-1' }))
    registeredCallbacks.CLS!(makeMetric({ name: 'CLS', value: 0.05, id: 'cls-1', rating: 'good' }))
    registeredCallbacks.INP!(makeMetric({ name: 'INP', value: 200, id: 'inp-1' }))

    expect(beacon).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2_000)

    expect(beacon).toHaveBeenCalledTimes(1)
    const [url, blob] = beacon.mock.calls[0]
    expect(url).toBe('/api/v1/web-vitals')
    expect(blob).toBeInstanceOf(Blob)
    const text = await (blob as Blob).text()
    const parsed = JSON.parse(text) as { metrics: VitalsPayload[] }
    expect(parsed.metrics).toHaveLength(3)
    expect(parsed.metrics.map(m => m.name).sort()).toEqual(['CLS', 'INP', 'LCP'])
    expect(parsed.metrics[0].route).toBe('/dashboard')
  })

  it('falls back to fetch when sendBeacon is unavailable', async () => {
    Object.defineProperty(navigator, 'sendBeacon', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    startWebVitalsReporter()
    registeredCallbacks.FCP!(makeMetric({ name: 'FCP', value: 800 }))

    await vi.advanceTimersByTimeAsync(2_000)

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/v1/web-vitals')
    const requestInit = init as RequestInit
    expect(requestInit.method).toBe('POST')
    expect((requestInit.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(requestInit.keepalive).toBe(true)
    const parsed = JSON.parse(requestInit.body as string) as { metrics: VitalsPayload[] }
    expect(parsed.metrics).toHaveLength(1)
    expect(parsed.metrics[0].name).toBe('FCP')
  })

  it('falls back to fetch when sendBeacon refuses the payload', async () => {
    beacon.mockReturnValue(false)
    startWebVitalsReporter()
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500 }))

    await vi.advanceTimersByTimeAsync(2_000)

    expect(beacon).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('flushes synchronously when the document becomes hidden', async () => {
    startWebVitalsReporter()
    registeredCallbacks.LCP!(makeMetric({ name: 'LCP', value: 1500 }))

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    })
    document.dispatchEvent(new Event('visibilitychange'))

    // Yield once for the queued microtask spawned by `void flush()`.
    await Promise.resolve()
    expect(beacon).toHaveBeenCalledTimes(1)
  })

  it('flushes when the page is being unloaded (pagehide)', async () => {
    startWebVitalsReporter()
    registeredCallbacks.INP!(makeMetric({ name: 'INP', value: 250 }))

    window.dispatchEvent(new Event('pagehide'))
    await Promise.resolve()

    expect(beacon).toHaveBeenCalledTimes(1)
  })

  it('does not call sendBeacon when the queue is empty', async () => {
    startWebVitalsReporter()
    await flush()
    expect(beacon).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('swallows network errors without throwing', async () => {
    Object.defineProperty(navigator, 'sendBeacon', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    fetchSpy.mockImplementation(() => Promise.reject(new Error('network down')))

    startWebVitalsReporter()
    registeredCallbacks.TTFB!(makeMetric({ name: 'TTFB', value: 120 }))

    await expect(vi.advanceTimersByTimeAsync(2_000)).resolves.not.toThrow()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
