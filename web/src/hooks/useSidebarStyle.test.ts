// Unit tests for `useSidebarStyle` — the localStorage-backed, cross-tab-synced
// sidebar layout preference. Exercises every export (the SIDEBAR_STYLES list,
// the imperative getter/setter, and the React hook) across its branches:
// default fallback, valid persistence, invalid/unknown rejection, the
// localStorage-throws fallback, and same-tab + cross-tab (`storage` event)
// re-render propagation. Follows the module-singleton test convention used by
// `store/__tests__/selectedVehicle.test.tsx` (act() + localStorage juggling)
// rather than resetting modules, which would introduce a second React copy and
// break `useSyncExternalStore`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

import {
  useSidebarStyle,
  setSidebarStyle,
  getSidebarStyle,
  SIDEBAR_STYLES,
  type SidebarStyle,
} from './useSidebarStyle'

// Mirrors the (intentionally private, versioned) storage key in the source.
// The persistence assertions below verify this literal, so if the source key
// ever changes the `persists a valid style` test fails loudly instead of
// silently reading a stale key.
const STORAGE_KEY = 'teslasync:sidebar-style:v1'

function dispatchStorage(key: string | null, newValue: string | null): void {
  window.dispatchEvent(new StorageEvent('storage', { key, newValue }))
}

// The module keeps a singleton in-memory cache that survives across tests in
// this file, so force it back to the 'linear' default before/after each test.
// setSidebarStyle mutates the cache directly (no mounted hook required).
function resetToDefault(): void {
  window.localStorage.clear()
  if (getSidebarStyle() !== 'linear') setSidebarStyle('linear')
  window.localStorage.clear()
}

beforeEach(() => {
  resetToDefault()
})

afterEach(() => {
  // Unmount any hooks before resetting module state so the reset's
  // setSidebarStyle() doesn't push an un-acted update into a live component
  // (RTL's own auto-cleanup afterEach otherwise runs after this hook).
  cleanup()
  vi.restoreAllMocks()
  resetToDefault()
})

describe('SIDEBAR_STYLES', () => {
  it('lists exactly the three supported styles in preference order', () => {
    expect(SIDEBAR_STYLES).toHaveLength(3)
    expect(SIDEBAR_STYLES).toEqual(['linear', 'notion', 'legacy'])
  })

  it('contains the default and every alternative style', () => {
    expect(SIDEBAR_STYLES).toContain('linear')
    expect(SIDEBAR_STYLES).toContain('notion')
    expect(SIDEBAR_STYLES).toContain('legacy')
  })
})

describe('getSidebarStyle / setSidebarStyle', () => {
  it('defaults to linear when nothing is persisted', () => {
    expect(getSidebarStyle()).toBe('linear')
  })

  it('persists a valid style to localStorage under the versioned key', () => {
    setSidebarStyle('notion')
    expect(getSidebarStyle()).toBe('notion')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('notion')
  })

  it('round-trips every supported style', () => {
    for (const style of SIDEBAR_STYLES) {
      setSidebarStyle(style)
      expect(getSidebarStyle()).toBe(style)
    }
  })

  it('ignores an unknown value and leaves storage untouched', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setSidebarStyle('hologram' as SidebarStyle)
    expect(getSidebarStyle()).toBe('linear')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('is a no-op when the value is unchanged', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setSidebarStyle('linear') // already the default
    expect(setItem).not.toHaveBeenCalled()
    expect(getSidebarStyle()).toBe('linear')
  })

  it('still updates the in-memory cache when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    setSidebarStyle('legacy')
    expect(getSidebarStyle()).toBe('legacy')
  })
})

describe('useSidebarStyle (React hook)', () => {
  it('returns the current style on first render', () => {
    setSidebarStyle('legacy')
    const { result } = renderHook(() => useSidebarStyle())
    expect(result.current).toBe('legacy')
  })

  it('re-renders when the style changes in the same tab', () => {
    const { result } = renderHook(() => useSidebarStyle())
    expect(result.current).toBe('linear')
    act(() => {
      setSidebarStyle('notion')
    })
    expect(result.current).toBe('notion')
  })

  it('re-renders when another tab changes the style via a storage event', () => {
    const { result } = renderHook(() => useSidebarStyle())
    act(() => {
      window.localStorage.setItem(STORAGE_KEY, 'legacy')
      dispatchStorage(STORAGE_KEY, 'legacy')
    })
    expect(result.current).toBe('legacy')
  })

  it('falls back to the default when another tab writes an invalid value', () => {
    const { result } = renderHook(() => useSidebarStyle())
    act(() => {
      setSidebarStyle('notion')
    })
    expect(result.current).toBe('notion')
    act(() => {
      window.localStorage.setItem(STORAGE_KEY, 'corrupted')
      dispatchStorage(STORAGE_KEY, 'corrupted')
    })
    expect(result.current).toBe('linear')
  })

  it('ignores storage events for unrelated keys', () => {
    const { result } = renderHook(() => useSidebarStyle())
    act(() => {
      window.localStorage.setItem('teslasync:something-else', 'notion')
      dispatchStorage('teslasync:something-else', 'notion')
    })
    expect(result.current).toBe('linear')
  })

  it('subscribes to the storage event on mount and cleans up on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useSidebarStyle())
    expect(add).toHaveBeenCalledWith('storage', expect.any(Function))
    unmount()
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function))
  })

  it('keeps multiple hook instances in sync from one source of truth', () => {
    const a = renderHook(() => useSidebarStyle())
    const b = renderHook(() => useSidebarStyle())
    expect(a.result.current).toBe('linear')
    expect(b.result.current).toBe('linear')
    act(() => {
      setSidebarStyle('notion')
    })
    expect(a.result.current).toBe('notion')
    expect(b.result.current).toBe('notion')
  })
})
