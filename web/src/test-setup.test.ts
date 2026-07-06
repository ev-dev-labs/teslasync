/**
 * `test-setup.ts` global test-harness contract.
 *
 * test-setup.ts is the vitest `setupFiles` entry (see vite.config.ts →
 * `test.setupFiles`) that every one of the SPA's hundreds of test files
 * transitively depends on. It has no exports — only load-bearing side
 * effects:
 *
 *   1. Three jsdom polyfills — IntersectionObserver / ResizeObserver /
 *      EventSource — that jsdom omits but framer-motion (useInView),
 *      Recharts (ResponsiveContainer) and our SSE code require.
 *   2. Two global module stubs — `useSettings` and `useTimezone` — so a
 *      bare `render()` / `renderHook()` (no QueryClientProvider / Router)
 *      does not crash with "No QueryClient set" the moment a component
 *      transitively reaches for units / date formatting.
 *   3. A `beforeEach` that resets the resilience auth-expired latch so a
 *      401-exercising test cannot silently no-op the next test in the file.
 *
 * A regression in any of these silently breaks or cross-contaminates the
 * whole suite, so this file pins each contract explicitly. The tests assert
 * the *observable effects* of the setup file (which has already executed as
 * the setupFile for this very test) rather than importing it — importing a
 * side-effect module would be a no-op against the singleton module graph.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSettings } from '@/hooks/useSettings'
import { useTimezone } from '@/lib/timezone'
import { _resetAuthExpiredLatch } from '@/lib/resilience'

describe('test-setup — IntersectionObserver polyfill', () => {
  it('installs a global IntersectionObserver constructor under jsdom', () => {
    expect(typeof globalThis.IntersectionObserver).toBe('function')
  })

  it('synchronously reports the observed target as fully intersecting', () => {
    const cb = vi.fn()
    const io = new IntersectionObserver(cb)
    const el = document.createElement('div')

    io.observe(el)

    // The mock fires the callback inline (real IO is async) so that
    // framer-motion's useInView flips visible during the test render.
    expect(cb).toHaveBeenCalledTimes(1)
    const [entries, observer] = cb.mock.calls[0] as [IntersectionObserverEntry[], IntersectionObserver]
    expect(entries).toHaveLength(1)
    expect(entries[0].isIntersecting).toBe(true)
    expect(entries[0].intersectionRatio).toBe(1)
    // The observed element is echoed back on the entry (DOM contract).
    expect(entries[0].target).toBe(el)
    // The observer instance is threaded through as the second argument.
    expect(observer).toBe(io)
  })

  it('exposes inert unobserve/disconnect and an empty takeRecords', () => {
    const io = new IntersectionObserver(() => {})
    const el = document.createElement('div')

    expect(() => io.unobserve(el)).not.toThrow()
    expect(() => io.disconnect()).not.toThrow()
    expect(io.takeRecords()).toEqual([])
  })
})

describe('test-setup — ResizeObserver polyfill', () => {
  it('installs a global ResizeObserver constructor under jsdom', () => {
    expect(typeof globalThis.ResizeObserver).toBe('function')
  })

  it('exposes inert observe/unobserve/disconnect that never throw', () => {
    const ro = new ResizeObserver(() => {})
    const el = document.createElement('div')

    // Recharts' ResponsiveContainer constructs a ResizeObserver on mount;
    // the mock must accept the full lifecycle without throwing.
    expect(() => ro.observe(el)).not.toThrow()
    expect(() => ro.unobserve(el)).not.toThrow()
    expect(() => ro.disconnect()).not.toThrow()
  })
})

describe('test-setup — EventSource mock', () => {
  it('exposes the CONNECTING/OPEN/CLOSED ready-state constants', () => {
    expect(EventSource.CONNECTING).toBe(0)
    expect(EventSource.OPEN).toBe(1)
    expect(EventSource.CLOSED).toBe(2)
  })

  it('opens immediately and records the URL it was constructed with', () => {
    const es = new EventSource('https://example.test/api/v1/stream')

    expect(es.url).toBe('https://example.test/api/v1/stream')
    expect(es.readyState).toBe(EventSource.OPEN)
  })

  it('transitions to CLOSED after close()', () => {
    const es = new EventSource('https://example.test/stream')
    expect(es.readyState).toBe(1)

    es.close()

    expect(es.readyState).toBe(2)
  })

  it('provides inert listener plumbing that never hits the network', () => {
    const es = new EventSource('https://example.test/stream')
    const handler = vi.fn()

    expect(() => es.addEventListener('message', handler)).not.toThrow()
    expect(() => es.removeEventListener('message', handler)).not.toThrow()
    expect(es.dispatchEvent(new Event('message'))).toBe(true)
    // A bare mock never fabricates events, so a registered handler stays
    // untouched — SSE tests drive `onmessage` manually instead.
    expect(handler).not.toHaveBeenCalled()
  })
})

describe('test-setup — global useSettings stub', () => {
  it('renders metric / Celsius / bar defaults without a QueryClient', () => {
    const { result } = renderHook(() => useSettings())

    expect(result.current.isMiles).toBe(false)
    expect(result.current.isFahrenheit).toBe(false)
    expect(result.current.isPSI).toBe(false)
    expect(result.current.settings.unit_of_length).toBe('km')
    expect(result.current.settings.unit_of_temp).toBe('C')
    expect(result.current.settings.unit_of_pressure).toBe('bar')
  })

  it('mirrors the production defaults for locale / decimals / density / range', () => {
    const { result } = renderHook(() => useSettings())

    expect(result.current.locale).toBe('en-US')
    expect(result.current.decimals).toBe(2)
    expect(result.current.density).toBe('comfortable')
    expect(result.current.rangeType).toBe('rated')
  })
})

describe('test-setup — global useTimezone stub', () => {
  it('resolves to UTC without vehicle / router context', () => {
    const { result } = renderHook(() => useTimezone())
    expect(result.current).toBe('UTC')
  })

  it('stays deterministic regardless of the requested tz mode', () => {
    // The global stub is intentionally mode-agnostic; per-file mocks add
    // mode sensitivity when a test needs it.
    expect(renderHook(() => useTimezone('user')).result.current).toBe('UTC')
    expect(renderHook(() => useTimezone('utc')).result.current).toBe('UTC')
    expect(renderHook(() => useTimezone('vehicle')).result.current).toBe('UTC')
  })
})

describe('test-setup — resilience auth-expired latch reset', () => {
  it('exposes the reset hook the setup beforeEach depends on', () => {
    // The setup wraps this call in try/catch precisely because a per-file
    // mock could strip it; the real module must still export it.
    expect(typeof _resetAuthExpiredLatch).toBe('function')
  })

  it('returns undefined and is idempotent across repeated calls', () => {
    expect(_resetAuthExpiredLatch()).toBeUndefined()
    expect(() => {
      _resetAuthExpiredLatch()
      _resetAuthExpiredLatch()
    }).not.toThrow()
  })
})
