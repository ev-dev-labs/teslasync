import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  reportFrontendError,
  installGlobalErrorReporting,
  __resetErrorReporterForTests,
  __setErrorReporterEnabledForTests,
  __getBufferedCountForTests,
  getRecentReportsForFeedback,
} from '../errorReporter'
import { RateLimitError, UpstreamUnavailableError } from '../resilience'

describe('errorReporter', () => {
  let originalFetch: typeof globalThis.fetch | undefined
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    __resetErrorReporterForTests()
    __setErrorReporterEnabledForTests(true)

    originalFetch = globalThis.fetch
    fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch

    // Default to online + a known route for assertions.
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
      writable: true,
    })
    Object.defineProperty(window, 'location', {
      value: { ...window.location, pathname: '/dashboard' },
      configurable: true,
    })
  })

  afterEach(() => {
    if (originalFetch === undefined) {
      delete (globalThis as { fetch?: typeof globalThis.fetch }).fetch
    } else {
      globalThis.fetch = originalFetch
    }
    vi.useRealTimers()
    __resetErrorReporterForTests()
  })

  it('skips POST when reporter is disabled (DEV mode)', () => {
    __setErrorReporterEnabledForTests(false)
    reportFrontendError(new Error('boom'), 'window')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs a typed Error and includes name, message, route, occurredAt, userAgent', () => {
    const err = new TypeError('Cannot read x of undefined')
    reportFrontendError(err, 'window')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('/api/v1/web-errors')
    const requestInit = init as RequestInit
    expect(requestInit.method).toBe('POST')
    expect((requestInit.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(requestInit.keepalive).toBe(true)
    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>
    expect(body.name).toBe('TypeError')
    expect(body.message).toBe('Cannot read x of undefined')
    expect(body.route).toBe('/dashboard')
    expect(typeof body.userAgent).toBe('string')
    expect(typeof body.occurredAt).toBe('string')
    expect(typeof body.stack).toBe('string')
  })

  it('coalesces identical (name+message+route) within the 60s window — only one POST', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-04T22:30:00.000Z'))

    for (let i = 0; i < 5; i++) {
      reportFrontendError(new TypeError('same'), 'window')
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Advance 30 s — still within window, still suppressed.
    vi.setSystemTime(new Date('2026-05-04T22:30:30.000Z'))
    reportFrontendError(new TypeError('same'), 'window')
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    // Advance past 60 s — bucket expires, next identical error sends.
    vi.setSystemTime(new Date('2026-05-04T22:31:01.000Z'))
    reportFrontendError(new TypeError('same'), 'window')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('treats different sources as independent buckets', () => {
    reportFrontendError(new TypeError('same'), 'window')
    reportFrontendError(new TypeError('same'), 'query')
    reportFrontendError(new TypeError('same'), 'react')
    reportFrontendError(new TypeError('same'), 'promise')

    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })

  it('treats different messages as independent buckets', () => {
    reportFrontendError(new TypeError('one'), 'window')
    reportFrontendError(new TypeError('two'), 'window')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('skips RateLimitError (handled by RateLimitBanner UI)', () => {
    reportFrontendError(new RateLimitError('429', 30, 'vehicles'), 'query')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips UpstreamUnavailableError (handled by waiting placeholder)', () => {
    reportFrontendError(new UpstreamUnavailableError('503', 30, 'tesla'), 'query')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips AbortError (intentional cancellation, not a bug)', () => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    reportFrontendError(abortErr, 'query')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips CanceledError (Axios-style cancellation)', () => {
    const canceledErr = new Error('canceled')
    canceledErr.name = 'CanceledError'
    reportFrontendError(canceledErr, 'query')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips null/undefined error values', () => {
    reportFrontendError(null, 'window')
    reportFrontendError(undefined, 'window')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('handles non-Error thrown values (string)', () => {
    reportFrontendError('something exploded', 'promise')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.name).toBe('Error')
    expect(body.message).toBe('something exploded')
  })

  it('handles non-Error thrown values (plain object)', () => {
    reportFrontendError({ code: 42, detail: 'bad' }, 'promise')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.name).toBe('Error')
    expect(body.message).toContain('42')
  })

  it('redacts sensitive diagnostic data before it reaches telemetry or support reports', () => {
    const err = new Error(
      'VIN 5YJ3E1EA7JF000123 owner=alice@example.com token=secret-value at 37.7749, -122.4194',
    )
    err.stack = 'Bearer secret-token\nat /share/private-token'

    reportFrontendError(err, 'react')

    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as Record<string, string>
    const attached = getRecentReportsForFeedback()[0]
    for (const value of [body.message, body.stack, attached.message, attached.stack]) {
      expect(value).not.toContain('5YJ3E1EA7JF000123')
      expect(value).not.toContain('alice@example.com')
      expect(value).not.toContain('secret-value')
      expect(value).not.toContain('37.7749')
      expect(value).not.toContain('secret-token')
    }
  })

  it('buffers reports while offline (up to MAX_BUFFER_SIZE)', () => {
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    })
    // Send 25 unique errors — buffer caps at 20, oldest dropped.
    for (let i = 0; i < 25; i++) {
      reportFrontendError(new Error(`offline-${i}`), 'window')
    }
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(__getBufferedCountForTests()).toBe(20)
  })

  it('flushes the offline buffer when the online event fires', () => {
    installGlobalErrorReporting()
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true,
    })
    reportFrontendError(new Error('queued-1'), 'window')
    reportFrontendError(new Error('queued-2'), 'window')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(__getBufferedCountForTests()).toBe(2)

    // Simulate connectivity returning.
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      configurable: true,
      writable: true,
    })
    window.dispatchEvent(new Event('online'))

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(__getBufferedCountForTests()).toBe(0)
  })

  it('installGlobalErrorReporting is idempotent', () => {
    installGlobalErrorReporting()
    installGlobalErrorReporting()
    // No throw, no duplicate listener — fire one error and assert
    // exactly one POST goes out.
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('once'), message: 'once' }))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('captures window error events via installed handler', () => {
    installGlobalErrorReporting()
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('window'), message: 'window' }))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.name).toBe('TypeError')
  })

  it('captures unhandledrejection events via installed handler', () => {
    installGlobalErrorReporting()
    const reason = new Error('rejected')
    const event = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(event, 'reason', { value: reason, configurable: true })
    window.dispatchEvent(event)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.message).toBe('rejected')
  })

  it('swallows fetch failures without throwing', () => {
    fetchSpy.mockImplementation(() => Promise.reject(new Error('network down')))
    expect(() => reportFrontendError(new Error('x'), 'window')).not.toThrow()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not crash when fetch is unavailable in the environment', () => {
    delete (globalThis as { fetch?: typeof globalThis.fetch }).fetch
    expect(() => reportFrontendError(new Error('x'), 'window')).not.toThrow()
  })
})
