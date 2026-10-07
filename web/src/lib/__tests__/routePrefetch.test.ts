import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isPrefetchablePath,
  prefetchRoute,
  schedulePrefetch,
  shouldPrefetchRoutes,
  TOUCH_INTENT_PREFETCH_DELAY_MS,
  __resetPrefetchedForTests,
  __getPrefetchedForTests,
} from '../routePrefetch'

/** Install a fake `navigator.connection` for one test. */
function withConnection(connection: Record<string, unknown> | undefined) {
  Object.defineProperty(navigator, 'connection', {
    value: connection,
    configurable: true,
  })
}

describe('routePrefetch', () => {
  beforeEach(() => {
    __resetPrefetchedForTests()
    withConnection(undefined)
  })

  afterEach(() => {
    withConnection(undefined)
    vi.useRealTimers()
  })

  describe('isPrefetchablePath', () => {
    it('returns true for known top-level routes', () => {
      expect(isPrefetchablePath('/')).toBe(true)
      expect(isPrefetchablePath('/battery')).toBe(true)
      expect(isPrefetchablePath('/drives')).toBe(true)
      expect(isPrefetchablePath('/charging')).toBe(true)
      expect(isPrefetchablePath('/live')).toBe(true)
    })

    it('resolves both parameterized patterns and concrete detail paths', () => {
      expect(isPrefetchablePath('/vehicles/:id')).toBe(true)
      expect(isPrefetchablePath('/vehicles/123')).toBe(true)
      expect(isPrefetchablePath('/drives/42/replay')).toBe(true)
      expect(isPrefetchablePath('/year-review/2025')).toBe(true)
    })

    it('ignores query strings, hashes, and trailing slashes', () => {
      expect(isPrefetchablePath('/battery?vehicle_id=7')).toBe(true)
      expect(isPrefetchablePath('/drives/42#telemetry')).toBe(true)
      expect(isPrefetchablePath('/charging/')).toBe(true)
    })

    it('returns false for unknown routes', () => {
      expect(isPrefetchablePath('/totally-not-a-route')).toBe(false)
      expect(isPrefetchablePath('/vehicles/123/missing')).toBe(false)
    })

    it('returns false for empty / falsy paths', () => {
      expect(isPrefetchablePath('')).toBe(false)
    })
  })

  describe('prefetchRoute', () => {
    it('records a known path immediately on call', () => {
      prefetchRoute('/battery')
      expect(__getPrefetchedForTests()).toContain('/battery')
    })

    it('is idempotent for repeated calls with the same path', () => {
      prefetchRoute('/drives')
      prefetchRoute('/drives')
      prefetchRoute('/drives')
      const matches = __getPrefetchedForTests().filter((p) => p === '/drives')
      expect(matches.length).toBe(1)
    })

    it('deduplicates concrete detail URLs by their shared lazy route chunk', () => {
      prefetchRoute('/vehicles/123')
      prefetchRoute('/vehicles/456?tab=access')
      expect(__getPrefetchedForTests()).toEqual(['/vehicles/:id'])
    })

    it('prefetches known routes when navigation state adds a query or hash', () => {
      prefetchRoute('/battery?vehicle_id=7#health')
      expect(__getPrefetchedForTests()).toEqual(['/battery'])
    })

    it('is a no-op for unknown paths', () => {
      prefetchRoute('/totally-not-a-route')
      expect(__getPrefetchedForTests()).toEqual([])
    })

    it('is a no-op for empty paths', () => {
      prefetchRoute('')
      expect(__getPrefetchedForTests()).toEqual([])
    })

    it('does not throw for unknown paths', () => {
      expect(() => prefetchRoute('/missing')).not.toThrow()
      expect(() => prefetchRoute('')).not.toThrow()
    })
  })

  describe('shouldPrefetchRoutes', () => {
    it('allows prefetch when the Network Information API is unavailable', () => {
      withConnection(undefined)
      expect(shouldPrefetchRoutes()).toBe(true)
    })

    it('allows prefetch on a fast connection with Data Saver off', () => {
      withConnection({ saveData: false, effectiveType: '4g' })
      expect(shouldPrefetchRoutes()).toBe(true)
    })

    it('refuses speculative downloads when the user enabled Data Saver', () => {
      withConnection({ saveData: true, effectiveType: '4g' })
      expect(shouldPrefetchRoutes()).toBe(false)
    })

    it('refuses speculative downloads on 2G-class connections', () => {
      withConnection({ saveData: false, effectiveType: '2g' })
      expect(shouldPrefetchRoutes()).toBe(false)
      withConnection({ saveData: false, effectiveType: 'slow-2g' })
      expect(shouldPrefetchRoutes()).toBe(false)
    })

    it('still allows 3g — only 2G-class links are excluded', () => {
      withConnection({ saveData: false, effectiveType: '3g' })
      expect(shouldPrefetchRoutes()).toBe(true)
    })
  })

  describe('network-aware prefetchRoute', () => {
    it('skips the download entirely under Data Saver', () => {
      withConnection({ saveData: true })
      prefetchRoute('/battery')
      expect(__getPrefetchedForTests()).toEqual([])
    })

    it('skips the download entirely on a 2G-class link', () => {
      withConnection({ effectiveType: 'slow-2g' })
      prefetchRoute('/drives')
      expect(__getPrefetchedForTests()).toEqual([])
    })

    it('resumes once conditions improve', () => {
      withConnection({ saveData: true })
      prefetchRoute('/battery')
      expect(__getPrefetchedForTests()).toEqual([])
      withConnection({ saveData: false, effectiveType: '4g' })
      prefetchRoute('/battery')
      expect(__getPrefetchedForTests()).toEqual(['/battery'])
    })
  })

  describe('schedulePrefetch', () => {
    it('defers the download until the touch-intent delay elapses', () => {
      vi.useFakeTimers()
      schedulePrefetch('/battery')
      expect(__getPrefetchedForTests()).toEqual([])
      vi.advanceTimersByTime(TOUCH_INTENT_PREFETCH_DELAY_MS)
      expect(__getPrefetchedForTests()).toEqual(['/battery'])
    })

    it('never downloads after the intent is cancelled — no stale update window', () => {
      vi.useFakeTimers()
      const cancel = schedulePrefetch('/drives')
      cancel()
      vi.advanceTimersByTime(TOUCH_INTENT_PREFETCH_DELAY_MS * 10)
      expect(__getPrefetchedForTests()).toEqual([])
    })

    it('is idempotent — cancelling twice (or after firing) is safe', () => {
      vi.useFakeTimers()
      const cancel = schedulePrefetch('/drives')
      expect(() => {
        cancel()
        cancel()
      }).not.toThrow()
      vi.advanceTimersByTime(TOUCH_INTENT_PREFETCH_DELAY_MS)

      const second = schedulePrefetch('/battery')
      vi.advanceTimersByTime(TOUCH_INTENT_PREFETCH_DELAY_MS)
      expect(__getPrefetchedForTests()).toEqual(['/battery'])
      expect(() => second()).not.toThrow()
      expect(__getPrefetchedForTests()).toEqual(['/battery'])
    })

    it('returns a no-op canceller for unknown paths', () => {
      vi.useFakeTimers()
      const cancel = schedulePrefetch('/not-a-route')
      vi.advanceTimersByTime(TOUCH_INTENT_PREFETCH_DELAY_MS)
      expect(__getPrefetchedForTests()).toEqual([])
      expect(() => cancel()).not.toThrow()
    })

    it('returns a no-op canceller when the connection forbids speculation', () => {
      vi.useFakeTimers()
      withConnection({ saveData: true })
      const cancel = schedulePrefetch('/battery')
      vi.advanceTimersByTime(TOUCH_INTENT_PREFETCH_DELAY_MS)
      expect(__getPrefetchedForTests()).toEqual([])
      expect(() => cancel()).not.toThrow()
    })

    it('honours a caller-supplied delay', () => {
      vi.useFakeTimers()
      schedulePrefetch('/battery', 500)
      vi.advanceTimersByTime(499)
      expect(__getPrefetchedForTests()).toEqual([])
      vi.advanceTimersByTime(1)
      expect(__getPrefetchedForTests()).toEqual(['/battery'])
    })
  })
})
