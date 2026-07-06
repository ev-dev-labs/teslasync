/**
 * useAchievementCelebrationPrefs hook tests.
 *
 * Exercises the localStorage-backed celebration-prefs store end-to-end:
 *   - documented defaults on a fresh store
 *   - partial-patch merge + full-object persistence
 *   - no-op / referentially-stable snapshot semantics (useSyncExternalStore
 *     contract — a stale reference here regresses into an infinite render)
 *   - multi-subscriber fan-out + unmount listener cleanup
 *   - cross-tab `storage` event handling, including the key filter
 *   - resilient readback: corrupt JSON, non-boolean fields, and missing keys
 *     all fall back to defaults
 *   - graceful degradation when `localStorage.setItem` throws (private mode)
 *   - the `undefined`-patch guard that keeps the live snapshot and the
 *     persisted copy in agreement
 *
 * The store caches a snapshot in module scope that survives across `it`
 * blocks, so `beforeEach` normalises the in-memory cache back to the
 * documented defaults and empties localStorage for a hermetic start.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  useAchievementCelebrationPrefs,
  setAchievementCelebrationPrefs,
  type AchievementCelebrationPrefs,
} from '../useAchievementCelebrationPrefs'

const CELEBRATION_KEY = 'teslasync:achievement-celebration:v1'

const DEFAULTS: AchievementCelebrationPrefs = {
  showToasts: true,
  playSound: false,
  showOnDashboard: true,
  pushOnUnlock: true,
}

/** Simulate another tab mutating storage. jsdom never fires this itself. */
function dispatchStorage(key: string): void {
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key }))
  })
}

beforeEach(() => {
  // Normalise the module-scoped snapshot, then start from an empty store.
  setAchievementCelebrationPrefs({ ...DEFAULTS })
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useAchievementCelebrationPrefs', () => {
  it('returns the documented defaults on a fresh store', () => {
    const { result } = renderHook(() => useAchievementCelebrationPrefs())
    const snapshot: AchievementCelebrationPrefs = result.current
    expect(snapshot).toEqual(DEFAULTS)
    expect(Object.keys(snapshot).sort()).toEqual([
      'playSound',
      'pushOnUnlock',
      'showOnDashboard',
      'showToasts',
    ])
  })

  it('returns a referentially stable snapshot across re-renders', () => {
    const { result, rerender } = renderHook(() => useAchievementCelebrationPrefs())
    const first = result.current
    rerender()
    // Stability matters: useSyncExternalStore raises an infinite-render if
    // getSnapshot yields a fresh object every call.
    expect(result.current).toBe(first)
    act(() => setAchievementCelebrationPrefs({ playSound: true }))
    // A real change swaps the reference so subscribers actually re-render.
    expect(result.current).not.toBe(first)
    expect(result.current.playSound).toBe(true)
  })
})

describe('setAchievementCelebrationPrefs', () => {
  it('merges a partial patch and persists the full object to localStorage', () => {
    const { result } = renderHook(() => useAchievementCelebrationPrefs())
    act(() => setAchievementCelebrationPrefs({ playSound: true }))
    expect(result.current.playSound).toBe(true)
    expect(result.current.showToasts).toBe(true) // untouched key retained
    const persisted = JSON.parse(localStorage.getItem(CELEBRATION_KEY) ?? '{}')
    expect(persisted).toEqual({ ...DEFAULTS, playSound: true })
  })

  it('is a no-op when the patch does not change any value', () => {
    const { result } = renderHook(() => useAchievementCelebrationPrefs())
    const before = result.current
    act(() => setAchievementCelebrationPrefs({ showToasts: true })) // already true
    expect(result.current).toBe(before) // no re-render, stable reference
    expect(localStorage.getItem(CELEBRATION_KEY)).toBeNull() // nothing written
  })

  it('notifies every mounted subscriber when a value changes', () => {
    const a = renderHook(() => useAchievementCelebrationPrefs())
    const b = renderHook(() => useAchievementCelebrationPrefs())
    act(() => setAchievementCelebrationPrefs({ showOnDashboard: false }))
    expect(a.result.current.showOnDashboard).toBe(false)
    expect(b.result.current.showOnDashboard).toBe(false)
  })

  it('removes its storage listener on unmount without breaking other subscribers', () => {
    const a = renderHook(() => useAchievementCelebrationPrefs())
    const b = renderHook(() => useAchievementCelebrationPrefs())
    a.unmount()
    expect(() =>
      act(() => setAchievementCelebrationPrefs({ showToasts: false })),
    ).not.toThrow()
    expect(b.result.current.showToasts).toBe(false)
  })

  it('keeps the in-memory snapshot when localStorage.setItem throws', () => {
    const { result } = renderHook(() => useAchievementCelebrationPrefs())
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
    act(() => setAchievementCelebrationPrefs({ pushOnUnlock: false }))
    // The current tab still reflects the toggle even though the write failed.
    expect(result.current.pushOnUnlock).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(CELEBRATION_KEY)).toBeNull()
  })
})

describe('setAchievementCelebrationPrefs — undefined patch guard', () => {
  it('ignores an undefined patch value instead of corrupting the snapshot', () => {
    const { result } = renderHook(() => useAchievementCelebrationPrefs())
    const before = result.current
    // `Partial<Prefs>` permits `undefined`; forwarding a `boolean | undefined`
    // value must NOT poison the store or diverge from localStorage.
    act(() => setAchievementCelebrationPrefs({ showToasts: undefined }))
    expect(result.current.showToasts).toBe(true) // still a real boolean
    expect(typeof result.current.showToasts).toBe('boolean')
    expect(result.current).toBe(before) // effectively a no-op
    expect(localStorage.getItem(CELEBRATION_KEY)).toBeNull()
  })

  it('applies real booleans while skipping undefined keys in the same patch', () => {
    const { result } = renderHook(() => useAchievementCelebrationPrefs())
    act(() =>
      setAchievementCelebrationPrefs({ showToasts: undefined, playSound: true }),
    )
    expect(result.current.playSound).toBe(true) // applied
    expect(result.current.showToasts).toBe(true) // untouched default, not undefined
    const persisted = JSON.parse(localStorage.getItem(CELEBRATION_KEY) ?? '{}')
    expect(persisted).toEqual({ ...DEFAULTS, playSound: true })
  })
})

describe('useAchievementCelebrationPrefs — cross-tab sync', () => {
  it('reacts to a cross-tab storage event for its own key', () => {
    const { result } = renderHook(() => useAchievementCelebrationPrefs())
    localStorage.setItem(
      CELEBRATION_KEY,
      JSON.stringify({ ...DEFAULTS, pushOnUnlock: false }),
    )
    dispatchStorage(CELEBRATION_KEY)
    expect(result.current.pushOnUnlock).toBe(false)
  })

  it('ignores storage events for unrelated keys, then reacts to its own', () => {
    const { result } = renderHook(() => useAchievementCelebrationPrefs())
    localStorage.setItem(
      CELEBRATION_KEY,
      JSON.stringify({ ...DEFAULTS, playSound: true }),
    )
    dispatchStorage('some-other-key')
    expect(result.current.playSound).toBe(false) // key filter blocked the refresh
    dispatchStorage(CELEBRATION_KEY)
    expect(result.current.playSound).toBe(true)
  })
})

describe('useAchievementCelebrationPrefs — resilient readback', () => {
  it('falls back to defaults when the persisted JSON is corrupt', () => {
    const { result } = renderHook(() => useAchievementCelebrationPrefs())
    act(() =>
      setAchievementCelebrationPrefs({
        showToasts: false,
        playSound: true,
        showOnDashboard: false,
        pushOnUnlock: false,
      }),
    )
    expect(result.current).toEqual({
      showToasts: false,
      playSound: true,
      showOnDashboard: false,
      pushOnUnlock: false,
    })
    localStorage.setItem(CELEBRATION_KEY, '{not valid json')
    dispatchStorage(CELEBRATION_KEY)
    expect(result.current).toEqual(DEFAULTS)
  })

  it('coerces non-boolean persisted fields back to their defaults', () => {
    const { result } = renderHook(() => useAchievementCelebrationPrefs())
    act(() =>
      setAchievementCelebrationPrefs({
        showToasts: false,
        playSound: true,
        showOnDashboard: false,
        pushOnUnlock: false,
      }),
    )
    expect(result.current.showToasts).toBe(false)
    localStorage.setItem(
      CELEBRATION_KEY,
      JSON.stringify({
        showToasts: 'x',
        playSound: 'y',
        showOnDashboard: 3,
        pushOnUnlock: null,
      }),
    )
    dispatchStorage(CELEBRATION_KEY)
    expect(result.current).toEqual(DEFAULTS)
  })

  it('fills missing persisted keys with their defaults', () => {
    const { result } = renderHook(() => useAchievementCelebrationPrefs())
    localStorage.setItem(CELEBRATION_KEY, JSON.stringify({ playSound: true }))
    dispatchStorage(CELEBRATION_KEY)
    expect(result.current.playSound).toBe(true)
    expect(result.current.showToasts).toBe(true)
    expect(result.current.showOnDashboard).toBe(true)
    expect(result.current.pushOnUnlock).toBe(true)
  })
})
