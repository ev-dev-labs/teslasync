import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import {
  DEFAULT_PINNED_NAV_PATHS,
  MAX_PINNED_NAV_ITEMS,
  MAX_RECENT_NAV_ITEMS,
  NAV_PINS_EVENT,
  PINNED_NAV_STORAGE_KEY,
  RECENT_NAV_STORAGE_KEY,
  __resetNavPinsSessionOverridesForTests,
  getPinnedNavPaths,
  getRecentNavPaths,
  isNavPathPinned,
  navPathsEqual,
  pinnedNavPathsNeedRewrite,
  recentNavPathsNeedRewrite,
  setPinnedNavPaths,
  setRecentNavPaths,
  subscribeNavPins,
  type NavPinsChangeDetail,
} from '../navPins'

beforeEach(() => {
  localStorage.clear()
  __resetNavPinsSessionOverridesForTests()
})

afterEach(() => {
  __resetNavPinsSessionOverridesForTests()
})

describe('getPinnedNavPaths', () => {
  it('falls back to the curated defaults when nothing was ever stored', () => {
    expect(getPinnedNavPaths()).toEqual([...DEFAULT_PINNED_NAV_PATHS])
  })

  it('respects an explicitly emptied list', () => {
    setPinnedNavPaths([])
    expect(getPinnedNavPaths()).toEqual([])
  })

  it('round-trips a user list in pin order', () => {
    setPinnedNavPaths(['/drives', '/charging'])
    expect(getPinnedNavPaths()).toEqual(['/drives', '/charging'])
  })

  it('survives malformed JSON without throwing', () => {
    localStorage.setItem(PINNED_NAV_STORAGE_KEY, 'not-json')
    expect(() => getPinnedNavPaths()).not.toThrow()
    expect(getPinnedNavPaths()).toEqual([...DEFAULT_PINNED_NAV_PATHS])
  })

  it('survives a non-array payload', () => {
    localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify({ a: 1 }))
    expect(getPinnedNavPaths()).toEqual([])
  })

  it('drops non-string and non-rooted entries (no off-site pins)', () => {
    localStorage.setItem(
      PINNED_NAV_STORAGE_KEY,
      JSON.stringify(['/drives', 42, null, 'https://evil.example', '//evil.example', '/charging']),
    )
    expect(getPinnedNavPaths()).toEqual(['/drives', '/charging'])
  })

  it('deduplicates and caps the list', () => {
    const many = Array.from({ length: 20 }, (_, i) => `/p${i}`)
    setPinnedNavPaths([...many, ...many])
    const stored = getPinnedNavPaths()
    expect(stored.length).toBe(MAX_PINNED_NAV_ITEMS)
    expect(new Set(stored).size).toBe(stored.length)
  })
})

describe('recent nav paths', () => {
  it('defaults to an empty list', () => {
    expect(getRecentNavPaths()).toEqual([])
  })

  it('caps recents at the documented maximum', () => {
    setRecentNavPaths(['/a', '/b', '/c', '/d', '/e'])
    expect(getRecentNavPaths().length).toBe(MAX_RECENT_NAV_ITEMS)
  })

  it('uses its own storage key', () => {
    setRecentNavPaths(['/drives'])
    expect(localStorage.getItem(RECENT_NAV_STORAGE_KEY)).toBe(JSON.stringify(['/drives']))
    expect(localStorage.getItem(PINNED_NAV_STORAGE_KEY)).toBeNull()
  })
})

describe('isNavPathPinned', () => {
  it('reports membership against the persisted list', () => {
    setPinnedNavPaths(['/drives'])
    expect(isNavPathPinned('/drives')).toBe(true)
    expect(isNavPathPinned('/charging')).toBe(false)
  })
})

describe('subscribeNavPins', () => {
  it('notifies same-tab writers and unsubscribes cleanly', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeNavPins(listener)

    setPinnedNavPaths(['/drives'])
    expect(listener).toHaveBeenCalledTimes(1)

    setRecentNavPaths(['/charging'])
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    setPinnedNavPaths(['/live'])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('notifies on cross-tab storage events for the pin keys only', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeNavPins(listener)

    window.dispatchEvent(new StorageEvent('storage', { key: PINNED_NAV_STORAGE_KEY }))
    expect(listener).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-key' }))
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
  })

  it('emits the documented same-tab event name', () => {
    const listener = vi.fn()
    window.addEventListener(NAV_PINS_EVENT, listener)
    setPinnedNavPaths(['/drives'])
    window.removeEventListener(NAV_PINS_EVENT, listener)
    expect(listener).toHaveBeenCalled()
  })
})

describe('storage failures', () => {
  it('never throws when localStorage.setItem is unavailable', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    try {
      expect(() => setPinnedNavPaths(['/drives'])).not.toThrow()
    } finally {
      Storage.prototype.setItem = original
    }
  })
})

describe('navPathsEqual', () => {
  it('treats identical ordered lists as equal', () => {
    expect(navPathsEqual(['/a', '/b'], ['/a', '/b'])).toBe(true)
  })

  it('is order-sensitive (pin order is user-visible)', () => {
    expect(navPathsEqual(['/a', '/b'], ['/b', '/a'])).toBe(false)
  })

  it('handles length differences and nullish inputs', () => {
    expect(navPathsEqual(['/a'], ['/a', '/b'])).toBe(false)
    expect(navPathsEqual(undefined, [])).toBe(true)
    expect(navPathsEqual(null, undefined)).toBe(true)
    expect(navPathsEqual(['/a'], null)).toBe(false)
  })
})

describe('rewrite guards', () => {
  it('does not ask for a write when nothing is stored and the list is the default', () => {
    expect(pinnedNavPathsNeedRewrite([...DEFAULT_PINNED_NAV_PATHS])).toBe(false)
    expect(recentNavPathsNeedRewrite([])).toBe(false)
  })

  it('asks for a write when the user diverges from the untouched default', () => {
    expect(pinnedNavPathsNeedRewrite(['/drives'])).toBe(true)
    expect(recentNavPathsNeedRewrite(['/drives'])).toBe(true)
  })

  it('does not ask for a write when storage already matches byte-for-byte', () => {
    setPinnedNavPaths(['/drives', '/charging'])
    expect(pinnedNavPathsNeedRewrite(['/drives', '/charging'])).toBe(false)
    setRecentNavPaths(['/battery'])
    expect(recentNavPathsNeedRewrite(['/battery'])).toBe(false)
  })

  it('asks for exactly one normalizing write when storage holds a dirty payload', () => {
    localStorage.setItem(
      PINNED_NAV_STORAGE_KEY,
      JSON.stringify(['/drives', 42, null, 'https://evil.example']),
    )
    const sanitized = getPinnedNavPaths()
    expect(sanitized).toEqual(['/drives'])
    expect(pinnedNavPathsNeedRewrite(sanitized)).toBe(true)

    setPinnedNavPaths(sanitized)
    expect(pinnedNavPathsNeedRewrite(sanitized)).toBe(false)
  })

  it('asks for a write when an explicitly emptied list differs from storage', () => {
    setPinnedNavPaths(['/drives'])
    expect(pinnedNavPathsNeedRewrite([])).toBe(true)
  })

  it('treats an explicitly stored empty list as settled', () => {
    setPinnedNavPaths([])
    expect(pinnedNavPathsNeedRewrite([])).toBe(false)
  })
})

// ─── Rejected writes must not lose the in-memory update ────────────────────

describe('failed writes (quota / private browsing)', () => {
  function withRejectedWrites<T>(run: () => T): T {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      const error = new Error('QuotaExceededError')
      error.name = 'QuotaExceededError'
      throw error
    }
    try {
      return run()
    } finally {
      Storage.prototype.setItem = original
    }
  }

  it('reports persisted=false for pins without throwing', () => {
    const result = withRejectedWrites(() => setPinnedNavPaths(['/drives', '/charging']))
    expect(result.persisted).toBe(false)
    expect(result.paths).toEqual(['/drives', '/charging'])
  })

  it('reports persisted=false for recents without throwing', () => {
    const result = withRejectedWrites(() => setRecentNavPaths(['/battery']))
    expect(result.persisted).toBe(false)
    expect(result.paths).toEqual(['/battery'])
  })

  it('keeps serving the in-memory pins instead of the stale stored list', () => {
    setPinnedNavPaths(['/drives'])
    expect(getPinnedNavPaths()).toEqual(['/drives'])

    withRejectedWrites(() => setPinnedNavPaths(['/charging', '/battery']))

    // Storage still holds the old value...
    expect(JSON.parse(localStorage.getItem(PINNED_NAV_STORAGE_KEY) as string)).toEqual([
      '/drives',
    ])
    // ...but the module must not resurrect it.
    expect(getPinnedNavPaths()).toEqual(['/charging', '/battery'])
  })

  it('keeps serving the in-memory recents instead of the stale stored list', () => {
    setRecentNavPaths(['/drives'])
    withRejectedWrites(() => setRecentNavPaths(['/battery']))

    expect(JSON.parse(localStorage.getItem(RECENT_NAV_STORAGE_KEY) as string)).toEqual([
      '/drives',
    ])
    expect(getRecentNavPaths()).toEqual(['/battery'])
  })

  it('publishes the sanitized payload so subscribers never re-read storage', () => {
    setPinnedNavPaths(['/drives'])
    const seen: NavPinsChangeDetail[] = []
    const unsubscribe = subscribeNavPins((detail) => seen.push(detail))

    withRejectedWrites(() => setPinnedNavPaths(['/charging', 42 as unknown as string]))
    unsubscribe()

    expect(seen).toHaveLength(1)
    expect(seen[0].source).toBe('local')
    expect(seen[0].persisted).toBe(false)
    // Sanitized in-memory payload, NOT the stale `['/drives']` from storage.
    expect(seen[0].pinned).toEqual(['/charging'])
  })

  it('publishes persisted=true on a successful write', () => {
    const seen: NavPinsChangeDetail[] = []
    const unsubscribe = subscribeNavPins((detail) => seen.push(detail))
    setPinnedNavPaths(['/drives'])
    unsubscribe()

    expect(seen[0].persisted).toBe(true)
    expect(seen[0].pinned).toEqual(['/drives'])
  })

  it('does not retry the same rejected list on every rewrite check', () => {
    withRejectedWrites(() => setPinnedNavPaths(['/charging']))
    // Same list → no point hammering a full quota.
    expect(pinnedNavPathsNeedRewrite(['/charging'])).toBe(false)
    // A genuinely new list must still attempt to persist.
    expect(pinnedNavPathsNeedRewrite(['/charging', '/battery'])).toBe(true)
  })

  it('does not retry the same rejected recent list either', () => {
    withRejectedWrites(() => setRecentNavPaths(['/battery']))
    expect(recentNavPathsNeedRewrite(['/battery'])).toBe(false)
    expect(recentNavPathsNeedRewrite(['/drives'])).toBe(true)
  })

  it('clears the in-memory fallback once a later write succeeds', () => {
    withRejectedWrites(() => setPinnedNavPaths(['/charging']))
    expect(getPinnedNavPaths()).toEqual(['/charging'])

    setPinnedNavPaths(['/battery'])
    expect(JSON.parse(localStorage.getItem(PINNED_NAV_STORAGE_KEY) as string)).toEqual([
      '/battery',
    ])
    expect(getPinnedNavPaths()).toEqual(['/battery'])
  })

  it('lets another tab take authority back through a storage event', () => {
    withRejectedWrites(() => setPinnedNavPaths(['/charging']))
    expect(getPinnedNavPaths()).toEqual(['/charging'])

    const seen: NavPinsChangeDetail[] = []
    const unsubscribe = subscribeNavPins((detail) => seen.push(detail))
    localStorage.setItem(PINNED_NAV_STORAGE_KEY, JSON.stringify(['/live']))
    window.dispatchEvent(new StorageEvent('storage', { key: PINNED_NAV_STORAGE_KEY }))
    unsubscribe()

    expect(seen).toHaveLength(1)
    expect(seen[0].source).toBe('storage')
    expect(seen[0].pinned).toEqual(['/live'])
    // Cross-tab semantics preserved: the foreign value wins over our fallback.
    expect(getPinnedNavPaths()).toEqual(['/live'])
  })

  it('keeps the pinned fallback when the storage event targets the recent key', () => {
    withRejectedWrites(() => setPinnedNavPaths(['/charging']))
    localStorage.setItem(RECENT_NAV_STORAGE_KEY, JSON.stringify(['/drives']))
    window.dispatchEvent(new StorageEvent('storage', { key: RECENT_NAV_STORAGE_KEY }))

    expect(getPinnedNavPaths()).toEqual(['/charging'])
    expect(getRecentNavPaths()).toEqual(['/drives'])
  })

  it('reports isNavPathPinned from the in-memory fallback', () => {
    setPinnedNavPaths(['/drives'])
    withRejectedWrites(() => setPinnedNavPaths(['/charging']))
    expect(isNavPathPinned('/charging')).toBe(true)
    expect(isNavPathPinned('/drives')).toBe(false)
  })
})
