// Co-located unit tests for the two navigation-guard hooks.
//
// Both hooks are thin adapters over the <NavigationGuardProvider> context, so
// we mock `useNavigationGuardContext` with a referentially-stable fake and,
// for the imperative navigator, mock react-router's `useNavigate`. That
// isolates the hook logic we actually own here — the ref-latest registration
// closures in `useNavigationGuard` and the confirm-then-navigate branch
// selection in `useGuardedNavigate` — from the provider's dialog / popstate
// machinery, which is exercised end-to-end in
// components/feedback/__tests__/NavigationGuardProvider.test.tsx.
//
// The context fake keeps a single stable object identity across renders,
// mirroring the provider's own `useMemo`'d value; that is what lets
// `useNavigationGuard`'s `[ctx, id]` effect register exactly once and observe
// prop changes purely through refs.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { NavigationGuardEntry } from '@/components/feedback/NavigationGuardProvider'

// Hoisted spies so the vi.mock factories below (which are themselves hoisted)
// can close over them.
const h = vi.hoisted(() => {
  const unregister = vi.fn()
  const register = vi.fn((_entry: NavigationGuardEntry) => unregister)
  const confirmIfDirty = vi.fn(async () => true)
  // Stable identity across renders — the effect dep `ctx` must not change.
  const ctx = { register, confirmIfDirty }
  const navigate = vi.fn()
  return { unregister, register, confirmIfDirty, ctx, navigate }
})

vi.mock('@/components/feedback/NavigationGuardProvider', () => ({
  useNavigationGuardContext: () => h.ctx,
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => h.navigate }
})

import { useNavigationGuard, useGuardedNavigate } from './useNavigationGuard'

beforeEach(() => {
  // register keeps its `() => unregister` implementation (mockClear preserves
  // it); the others are reset so per-test implementations never leak forward.
  h.register.mockClear()
  h.unregister.mockClear()
  h.confirmIfDirty.mockReset()
  h.confirmIfDirty.mockResolvedValue(true)
  h.navigate.mockReset()
})

/** The most-recent GuardEntry object handed to `ctx.register`. */
function lastEntry(): NavigationGuardEntry {
  const { calls } = h.register.mock
  const call = calls[calls.length - 1]
  if (!call) throw new Error('ctx.register was never called')
  return call[0]
}

// A `use`-prefixed wrapper so two guards mount in one tree (unambiguous for
// react-hooks/rules-of-hooks) — needed to prove per-instance id + ref
// isolation, which two independent renderHook roots cannot guarantee.
function useGuardPair() {
  useNavigationGuard(true, 'first-guard')
  useNavigationGuard(false, 'second-guard')
}

describe('useNavigationGuard — registration contract', () => {
  it('registers exactly one guard on mount with an id and live callbacks', () => {
    renderHook(() => useNavigationGuard(true, 'Unsaved rule'))

    expect(h.register).toHaveBeenCalledTimes(1)
    const entry = lastEntry()
    expect(typeof entry.id).toBe('string')
    expect(entry.id.length).toBeGreaterThan(0)
    expect(typeof entry.isDirty).toBe('function')
    expect(typeof entry.getMessage).toBe('function')
    // Closures reflect the initial props.
    expect(entry.isDirty()).toBe(true)
    expect(entry.getMessage()).toBe('Unsaved rule')
  })

  it('reads the LATEST isDirty/message through refs without re-registering', () => {
    const { rerender } = renderHook(
      ({ dirty, msg }: { dirty: boolean; msg?: string }) => useNavigationGuard(dirty, msg),
      { initialProps: { dirty: true, msg: 'first' } },
    )
    const entry = lastEntry()
    expect(entry.isDirty()).toBe(true)
    expect(entry.getMessage()).toBe('first')

    const callsBefore = h.register.mock.calls.length
    rerender({ dirty: false, msg: 'second' })

    // Same registered entry; only [ctx, id] gate the effect, so no re-register.
    expect(h.register.mock.calls.length).toBe(callsBefore)
    expect(entry.isDirty()).toBe(false)
    expect(entry.getMessage()).toBe('second')

    // Clearing the message drops back to undefined (provider then shows the
    // generic warning copy) — the ref must not stick to the old string.
    rerender({ dirty: false, msg: undefined })
    expect(entry.getMessage()).toBeUndefined()
  })

  it('defaults getMessage() to undefined when no message is supplied', () => {
    renderHook(() => useNavigationGuard(true))
    expect(lastEntry().getMessage()).toBeUndefined()
  })

  it('unregisters via the register cleanup exactly once on unmount', () => {
    const { unmount } = renderHook(() => useNavigationGuard(true))
    expect(h.unregister).not.toHaveBeenCalled()

    unmount()
    expect(h.unregister).toHaveBeenCalledTimes(1)
  })

  it('gives each mounted guard a distinct id and isolated ref closures', () => {
    renderHook(() => useGuardPair())

    expect(h.register).toHaveBeenCalledTimes(2)
    const first = h.register.mock.calls[0][0]
    const second = h.register.mock.calls[1][0]

    expect(first.id).not.toBe(second.id)
    // Each closure resolves to its own instance's props, not a shared ref.
    expect(first.isDirty()).toBe(true)
    expect(first.getMessage()).toBe('first-guard')
    expect(second.isDirty()).toBe(false)
    expect(second.getMessage()).toBe('second-guard')
  })
})

describe('useGuardedNavigate — confirm-then-navigate', () => {
  it('navigates to a path with options when the guard resolves clean', async () => {
    h.confirmIfDirty.mockResolvedValue(true)
    const { result } = renderHook(() => useGuardedNavigate())

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current('/automations', { replace: true })
    })

    expect(h.confirmIfDirty).toHaveBeenCalledTimes(1)
    expect(h.navigate).toHaveBeenCalledWith('/automations', { replace: true })
    expect(ok).toBe(true)
  })

  it('aborts navigation and resolves false when the user keeps editing', async () => {
    h.confirmIfDirty.mockResolvedValue(false)
    const { result } = renderHook(() => useGuardedNavigate())

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current('/automations')
    })

    expect(h.confirmIfDirty).toHaveBeenCalledTimes(1)
    expect(h.navigate).not.toHaveBeenCalled()
    expect(ok).toBe(false)
  })

  it('treats a numeric target as a history delta and drops options', async () => {
    const { result } = renderHook(() => useGuardedNavigate())

    await act(async () => {
      // Options are intentionally passed to prove they are dropped for the
      // numeric (delta) overload, which react-router does not accept them on.
      await result.current(-1, { replace: true })
    })

    expect(h.navigate).toHaveBeenCalledTimes(1)
    expect(h.navigate).toHaveBeenCalledWith(-1)
    expect(h.navigate.mock.calls[0]).toHaveLength(1)
  })

  it('consults the guard BEFORE navigating', async () => {
    const order: string[] = []
    h.confirmIfDirty.mockImplementation(async () => {
      order.push('confirm')
      return true
    })
    h.navigate.mockImplementation(() => {
      order.push('navigate')
    })
    const { result } = renderHook(() => useGuardedNavigate())

    await act(async () => {
      await result.current('/x')
    })

    expect(order).toEqual(['confirm', 'navigate'])
  })

  it('returns a stable (memoised) callback across re-renders', () => {
    const { result, rerender } = renderHook(() => useGuardedNavigate())
    const first = result.current

    rerender()
    expect(result.current).toBe(first)
  })
})
