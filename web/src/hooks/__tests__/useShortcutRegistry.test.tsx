import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  useShortcut,
  useActiveShortcuts,
  useAllShortcuts,
  registerShortcut,
  unregisterShortcut,
  _resetShortcutRegistry,
  type ShortcutDefinition,
} from '../useShortcutRegistry'

function wrapperWith(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  )
}

afterEach(() => {
  _resetShortcutRegistry()
})

describe('useShortcutRegistry', () => {
  describe('useShortcut + useAllShortcuts', () => {
    it('registers an entry on mount and removes on unmount', () => {
      const def: ShortcutDefinition = {
        id: 'tc.basic',
        keys: ['x'],
        description: 'X',
        group: 'Test',
        scope: 'global',
      }
      const { result, unmount } = renderHook(
        () => {
          useShortcut(def)
          return useAllShortcuts()
        },
        { wrapper: wrapperWith('/') },
      )
      expect(result.current.find((d) => d.id === 'tc.basic')).toBeTruthy()
      unmount()
      // After unmount the entry is gone from the registry.
      expect(getAllShortcutsSync().find((d) => d.id === 'tc.basic')).toBeFalsy()
    })

    it('deduplicates registrations by id (last writer wins)', () => {
      registerShortcut({
        id: 'dupe',
        keys: ['a'],
        description: 'first',
        group: 'g',
        scope: 'global',
      })
      registerShortcut({
        id: 'dupe',
        keys: ['b'],
        description: 'second',
        group: 'g',
        scope: 'global',
      })
      const all = getAllShortcutsSync()
      const matches = all.filter((d) => d.id === 'dupe')
      expect(matches).toHaveLength(1)
      expect(matches[0].description).toBe('second')
    })

    it('survives strict-mode-style double mount without duplicating', () => {
      const def: ShortcutDefinition = {
        id: 'tc.strict',
        keys: ['s'],
        description: 'strict',
        group: 'Test',
        scope: 'global',
      }
      // Simulate React 18 strict mode: mount, cleanup, mount.
      const { unmount: u1 } = renderHook(() => useShortcut(def), {
        wrapper: wrapperWith('/'),
      })
      u1()
      const { result } = renderHook(
        () => {
          useShortcut(def)
          return useAllShortcuts()
        },
        { wrapper: wrapperWith('/') },
      )
      expect(result.current.filter((d) => d.id === 'tc.strict')).toHaveLength(1)
    })
  })

  describe('useActiveShortcuts (route filtering)', () => {
    it('returns global entries on every route', () => {
      registerShortcut({
        id: 'g.always',
        keys: ['?'],
        description: 'help',
        group: 'Actions',
        scope: 'global',
      })
      const { result } = renderHook(() => useActiveShortcuts(), {
        wrapper: wrapperWith('/anywhere'),
      })
      expect(result.current.some((d) => d.id === 'g.always')).toBe(true)
    })

    it('hides route-scoped entries that do not match the current pathname', () => {
      registerShortcut({
        id: 'r.replay',
        keys: ['Space'],
        description: 'play',
        group: 'Replay',
        scope: 'route',
        routeMatch: '/drives/',
      })
      const { result } = renderHook(() => useActiveShortcuts(), {
        wrapper: wrapperWith('/charging'),
      })
      expect(result.current.some((d) => d.id === 'r.replay')).toBe(false)
    })

    it('shows route-scoped entries when the prefix matches', () => {
      registerShortcut({
        id: 'r.replay',
        keys: ['Space'],
        description: 'play',
        group: 'Replay',
        scope: 'route',
        routeMatch: '/drives/',
      })
      const { result } = renderHook(() => useActiveShortcuts(), {
        wrapper: wrapperWith('/drives/42/replay'),
      })
      expect(result.current.some((d) => d.id === 'r.replay')).toBe(true)
    })

    it('supports regex routeMatch', () => {
      registerShortcut({
        id: 'r.regex',
        keys: ['x'],
        description: 'regex',
        group: 'Replay',
        scope: 'route',
        routeMatch: /\/drives\/[^/]+\/replay/,
      })
      const { result, rerender } = renderHook(() => useActiveShortcuts(), {
        wrapper: wrapperWith('/drives/42/replay'),
      })
      expect(result.current.some((d) => d.id === 'r.regex')).toBe(true)

      rerender()
      // Direct render under non-matching path: regex should reject.
      const { result: result2 } = renderHook(() => useActiveShortcuts(), {
        wrapper: wrapperWith('/drives/42'),
      })
      expect(result2.current.some((d) => d.id === 'r.regex')).toBe(false)
    })
  })

  describe('delegated handler', () => {
    it('invokes the registered handler when the match predicate is true', () => {
      const handler = vi.fn()
      renderHook(
        () =>
          useShortcut({
            id: 'h.match',
            keys: ['x'],
            description: 'x',
            group: 'g',
            scope: 'global',
            match: (e) => e.key === 'x',
            handler,
          }),
        { wrapper: wrapperWith('/') },
      )
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }))
      })
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('skips the handler when focus is on a typing target (unless allowInInput)', () => {
      const handler = vi.fn()
      renderHook(
        () =>
          useShortcut({
            id: 'h.typing',
            keys: ['x'],
            description: 'x',
            group: 'g',
            scope: 'global',
            match: (e) => e.key === 'x',
            handler,
          }),
        { wrapper: wrapperWith('/') },
      )
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'x', bubbles: true }),
        )
      })
      expect(handler).not.toHaveBeenCalled()
      document.body.removeChild(input)
    })

    it('always fires Escape even from a typing target', () => {
      const handler = vi.fn()
      renderHook(
        () =>
          useShortcut({
            id: 'h.escape',
            keys: ['Esc'],
            description: 'esc',
            group: 'g',
            scope: 'global',
            match: (e) => e.key === 'Escape',
            handler,
          }),
        { wrapper: wrapperWith('/') },
      )
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.focus()
      act(() => {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        )
      })
      expect(handler).toHaveBeenCalledTimes(1)
      document.body.removeChild(input)
    })

    it('skips route-scoped handlers when the current route does not match', () => {
      const handler = vi.fn()
      // Use registerShortcut directly so we can control the pathname via JSDOM.
      registerShortcut({
        id: 'h.route',
        keys: ['x'],
        description: 'x',
        group: 'g',
        scope: 'route',
        routeMatch: '/never-matches',
        match: (e) => e.key === 'x',
        handler,
      })
      // Need at least one component using the registry for the listener to be attached.
      renderHook(() => useAllShortcuts(), { wrapper: wrapperWith('/') })
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }))
      })
      expect(handler).not.toHaveBeenCalled()
      unregisterShortcut('h.route')
    })
  })
})

/** Snapshot helper that bypasses React rendering so we can assert post-unmount. */
function getAllShortcutsSync(): ShortcutDefinition[] {
  // Re-export of the same internal store via the public API for tests.
  // We hit the registry by registering a probe and reading back via a
  // throwaway hook render.
  let snapshot: ShortcutDefinition[] = []
  renderHook(
    () => {
      snapshot = useAllShortcuts()
    },
    { wrapper: wrapperWith('/') },
  )
  return snapshot
}
