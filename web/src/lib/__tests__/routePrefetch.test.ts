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

    it('returns true for known parameterized routes (matched by literal pattern)', () => {
      // Parameterized routes appear in PRELOADERS keyed by their pattern,
      // not by a concrete value. The pattern match is intentional —
      // hovers never produce literal `/vehicles/:id` strings, so this
      // entry is mostly for completeness and audit symmetry.
      expect(isPrefetchablePath('/vehicles/:id')).toBe(true)
    })

    it('returns false for unknown routes', () => {
      expect(isPrefetchablePath('/totally-not-a-route')).toBe(false)
      expect(isPrefetchablePath('/vehicles/123')).toBe(false)
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
