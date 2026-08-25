import { describe, it, expect, beforeEach } from 'vitest'
import {
  isPrefetchablePath,
  prefetchRoute,
  __resetPrefetchedForTests,
  __getPrefetchedForTests,
} from '../routePrefetch'

describe('routePrefetch', () => {
  beforeEach(() => {
    __resetPrefetchedForTests()
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
})
