/**
 * recentPages contract tests.
 *
 * Co-located next to the source because path-scoped checks match
 * `lib/recentPages` as a contiguous substring.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetRecentPagesForTests,
  classifyPath,
  clearRecentPages,
  getRecentPages,
  recordPageView,
  RECENT_PAGES_MAX,
  RECENT_PAGES_STORAGE_KEY,
  resolvePageLabel,
  shouldRecordPath,
  subscribeRecentPages,
} from './recentPages'

beforeEach(() => {
  window.localStorage.clear()
  __resetRecentPagesForTests()
})

afterEach(() => {
  __resetRecentPagesForTests()
})

describe('recentPages — recording', () => {
  it('records a single visit and surfaces it from getRecentPages', () => {
    recordPageView({ path: '/vehicles/3', title: 'Model 3' })
    const list = getRecentPages()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      path: '/vehicles/3',
      title: 'Model 3',
      kind: 'vehicle',
      ref_id: '3',
    })
    expect(typeof list[0].visited_at).toBe('number')
  })

  it('uses an explicit kind/ref_id when provided', () => {
    recordPageView({
      path: '/vehicles/7',
      title: 'Roadster',
      kind: 'page',
      ref_id: 'override',
    })
    const list = getRecentPages()
    expect(list[0].kind).toBe('page')
    expect(list[0].ref_id).toBe('override')
  })

  it('falls back to the path when title is empty', () => {
    recordPageView({ path: '/efficiency', title: '   ' })
    expect(getRecentPages()[0].title).toBe('/efficiency')
  })

  it('moves a re-visited entry to the top with a fresh timestamp', () => {
    recordPageView({ path: '/vehicles/1', title: 'A', now: 1_000 })
    recordPageView({ path: '/vehicles/2', title: 'B', now: 2_000 })
    recordPageView({ path: '/vehicles/1', title: 'A again', now: 3_000 })
    const list = getRecentPages()
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({
      path: '/vehicles/1',
      title: 'A again',
      visited_at: 3_000,
    })
    expect(list[1].path).toBe('/vehicles/2')
  })

  it('caps the list at RECENT_PAGES_MAX entries', () => {
    for (let i = 0; i < RECENT_PAGES_MAX + 5; i++) {
      recordPageView({ path: `/page-${i}`, title: `Page ${i}`, now: i })
    }
    const list = getRecentPages()
    expect(list).toHaveLength(RECENT_PAGES_MAX)
    // Oldest entries should have been evicted.
    expect(list[0].path).toBe(`/page-${RECENT_PAGES_MAX + 4}`)
    expect(list[list.length - 1].path).toBe('/page-5')
  })

  it('honours the limit argument on getRecentPages', () => {
    recordPageView({ path: '/a', title: 'A', now: 1 })
    recordPageView({ path: '/b', title: 'B', now: 2 })
    recordPageView({ path: '/c', title: 'C', now: 3 })
    expect(getRecentPages(2).map((e) => e.path)).toEqual(['/c', '/b'])
    expect(getRecentPages(0)).toEqual([])
    expect(getRecentPages(-1)).toEqual([])
  })
})

describe('recentPages — clearing', () => {
  it('removes every entry', () => {
    recordPageView({ path: '/x', title: 'X' })
    recordPageView({ path: '/y', title: 'Y' })
    expect(getRecentPages()).toHaveLength(2)
    clearRecentPages()
    expect(getRecentPages()).toEqual([])
    expect(window.localStorage.getItem(RECENT_PAGES_STORAGE_KEY)).toBeNull()
  })

  it('is idempotent on an already-empty store', () => {
    expect(() => clearRecentPages()).not.toThrow()
    expect(getRecentPages()).toEqual([])
  })
})

describe('recentPages — subscription', () => {
  it('fires same-tab subscribers on record + clear', () => {
    const handler = vi.fn()
    const unsub = subscribeRecentPages(handler)
    recordPageView({ path: '/foo', title: 'Foo' })
    recordPageView({ path: '/bar', title: 'Bar' })
    clearRecentPages()
    expect(handler).toHaveBeenCalledTimes(3)
    unsub()
  })

  it('fires when another tab writes (synthetic StorageEvent)', () => {
    const handler = vi.fn()
    const unsub = subscribeRecentPages(handler)
    // Simulate a sibling tab writing to the same key — the storage
    // event only fires in OTHER tabs, but we can dispatch a synthetic
    // one to exercise the listener.
    const ev = new StorageEvent('storage', {
      key: RECENT_PAGES_STORAGE_KEY,
      newValue: JSON.stringify([
        { path: '/cross', title: 'Cross', kind: 'page', visited_at: Date.now() },
      ]),
    })
    window.dispatchEvent(ev)
    expect(handler).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('ignores StorageEvents for unrelated keys', () => {
    const handler = vi.fn()
    const unsub = subscribeRecentPages(handler)
    const ev = new StorageEvent('storage', { key: 'some-other-key' })
    window.dispatchEvent(ev)
    expect(handler).not.toHaveBeenCalled()
    unsub()
  })

  it('stops firing after unsubscribe', () => {
    const handler = vi.fn()
    const unsub = subscribeRecentPages(handler)
    unsub()
    recordPageView({ path: '/post-unsub', title: 'PU' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('survives a throwing subscriber without aborting other writes', () => {
    const bad = vi.fn(() => {
      throw new Error('nope')
    })
    const good = vi.fn()
    const unsubBad = subscribeRecentPages(bad)
    const unsubGood = subscribeRecentPages(good)
    expect(() => recordPageView({ path: '/safe', title: 'S' })).not.toThrow()
    expect(bad).toHaveBeenCalledTimes(1)
    expect(good).toHaveBeenCalledTimes(1)
    unsubBad()
    unsubGood()
  })
})

describe('recentPages — shouldRecordPath', () => {
  it('accepts normal pathnames', () => {
    expect(shouldRecordPath('/')).toBe(true)
    expect(shouldRecordPath('/vehicles')).toBe(true)
    expect(shouldRecordPath('/vehicles/3')).toBe(true)
    expect(shouldRecordPath('/drives/42/replay')).toBe(true)
  })

  it('rejects empty / non-absolute / non-string paths', () => {
    expect(shouldRecordPath('')).toBe(false)
    expect(shouldRecordPath('vehicles')).toBe(false)
    // @ts-expect-error — defensive runtime guard for non-string input.
    expect(shouldRecordPath(undefined)).toBe(false)
    // @ts-expect-error — defensive runtime guard for non-string input.
    expect(shouldRecordPath(null)).toBe(false)
  })

  it('rejects skip-listed routes', () => {
    expect(shouldRecordPath('/onboarding')).toBe(false)
    expect(shouldRecordPath('/onboarding/foo')).toBe(false)
    expect(shouldRecordPath('/watch')).toBe(false)
    expect(shouldRecordPath('/s/abc-token')).toBe(false)
    expect(shouldRecordPath('/search')).toBe(false)
    expect(shouldRecordPath('/me/activity')).toBe(false)
  })

  it('does not over-match prefixes', () => {
    // `/searchx` is not `/search` — must still be recorded.
    expect(shouldRecordPath('/searchx')).toBe(true)
    expect(shouldRecordPath('/onboarding-extra')).toBe(true)
  })

  it('recordPageView is a no-op for skipped paths', () => {
    recordPageView({ path: '/search', title: 'Search' })
    recordPageView({ path: '/onboarding', title: 'Onboarding' })
    recordPageView({ path: '/s/share-token', title: 'Shared' })
    expect(getRecentPages()).toEqual([])
  })
})

describe('recentPages — classifyPath', () => {
  it('recognises every well-known dynamic route', () => {
    expect(classifyPath('/vehicles/3')).toEqual({ kind: 'vehicle', ref_id: '3' })
    expect(classifyPath('/vehicles/3/access')).toEqual({
      kind: 'vehicle',
      ref_id: '3',
    })
    expect(classifyPath('/drives/42')).toEqual({ kind: 'drive', ref_id: '42' })
    expect(classifyPath('/drives/42/replay')).toEqual({
      kind: 'drive',
      ref_id: '42',
    })
    expect(classifyPath('/charging/100')).toEqual({
      kind: 'charging',
      ref_id: '100',
    })
    expect(classifyPath('/trips/7')).toEqual({ kind: 'trip', ref_id: '7' })
    expect(classifyPath('/geofences/9')).toEqual({
      kind: 'geofence',
      ref_id: '9',
    })
    expect(classifyPath('/year-review/2024')).toEqual({
      kind: 'year-review',
      ref_id: '2024',
    })
  })

  it('falls back to plain "page" for static routes', () => {
    expect(classifyPath('/')).toEqual({ kind: 'page' })
    expect(classifyPath('/efficiency')).toEqual({ kind: 'page' })
    expect(classifyPath('/settings')).toEqual({ kind: 'page' })
  })
})

describe('recentPages — resolvePageLabel', () => {
  it('returns the registry label for an exact match', () => {
    expect(resolvePageLabel('/vehicles')).toBe('Vehicles')
    expect(resolvePageLabel('/charging')).toBe('Charging')
    expect(resolvePageLabel('/')).toBe('Dashboard')
  })

  it('returns the registry label for a parameterized match', () => {
    expect(resolvePageLabel('/vehicles/3')).toBe('Vehicle Detail')
    expect(resolvePageLabel('/drives/42/replay')).toBe('Trip Replay')
  })

  it('returns null for an unknown path', () => {
    expect(resolvePageLabel('/no-such-route')).toBeNull()
    expect(resolvePageLabel('')).toBeNull()
  })
})

describe('recentPages — corrupt / missing storage', () => {
  it('returns an empty list when localStorage payload is malformed', () => {
    window.localStorage.setItem(RECENT_PAGES_STORAGE_KEY, '{not json')
    expect(getRecentPages()).toEqual([])
  })

  it('returns an empty list when payload is not an array', () => {
    window.localStorage.setItem(RECENT_PAGES_STORAGE_KEY, JSON.stringify({ a: 1 }))
    expect(getRecentPages()).toEqual([])
  })

  it('drops malformed individual entries', () => {
    window.localStorage.setItem(
      RECENT_PAGES_STORAGE_KEY,
      JSON.stringify([
        { path: '/ok', title: 'OK', kind: 'page', visited_at: 1 },
        { path: 123 }, // wrong type
        null,
        { path: '/also-ok', title: 'Also', kind: 'page', visited_at: 2 },
      ]),
    )
    const list = getRecentPages()
    expect(list.map((e) => e.path)).toEqual(['/ok', '/also-ok'])
  })
})
