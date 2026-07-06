/**
 * `usePreferredRange` — range-type-aware range selection hook.
 *
 * The hook reads the user's `rangeType` preference from `useSettings()` and
 * projects a vehicle/charge state snapshot onto the "preferred" range value
 * (rated vs ideal) plus stable i18n label metadata. These tests cover the
 * hook's entire public surface:
 *   - rated / ideal / fallback branch selection
 *   - null-safe loading behaviour (null / undefined state → null meters, but a
 *     stable label so loading UIs don't flicker)
 *   - value edge cases (0 preserved, explicit null treated as missing, the
 *     non-selected field ignored)
 *   - useMemo referential stability + recomputation on input changes
 *   - the exact result contract (keys + types), which also exercises the
 *     re-exported `RangeType` / `PreferredRangeFields` / `PreferredRangeResult`
 *     type aliases.
 *
 * `useSettings` is mocked per-file so `rangeType` can be driven deterministically.
 * This file-level `vi.mock` intentionally overrides the global stub installed in
 * `test-setup.ts` (which pins `rangeType: 'rated'` and would otherwise make the
 * `ideal` and fallback branches unreachable).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

// Drives the mocked `useSettings().rangeType`. The `mock` name prefix is what
// lets Vitest reference it inside the hoisted factory below without tripping
// the "cannot access before initialization" guard.
let mockRangeType: string | null | undefined = 'rated'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ rangeType: mockRangeType }),
}))

import { usePreferredRange } from '../usePreferredRange'
import type {
  PreferredRangeFields,
  PreferredRangeResult,
  RangeType,
} from '../usePreferredRange'

/** 400 km / 500 km expressed in SI metres (the hook is unit-agnostic). */
const RATED_M = 400_000
const IDEAL_M = 500_000
const BOTH: PreferredRangeFields = { rated_range: RATED_M, ideal_range: IDEAL_M }

beforeEach(() => {
  mockRangeType = 'rated'
})

describe('usePreferredRange — branch selection', () => {
  it('selects the rated range under the default "rated" preference', () => {
    mockRangeType = 'rated'
    const { result } = renderHook(() => usePreferredRange(BOTH))
    expect(result.current.meters).toBe(RATED_M)
    expect(result.current.source).toBe('rated')
    expect(result.current.labelKey).toBe('ratedRange')
    expect(result.current.defaultLabel).toBe('Rated Range')
  })

  it('selects the ideal range under the "ideal" preference', () => {
    mockRangeType = 'ideal'
    const { result } = renderHook(() => usePreferredRange(BOTH))
    expect(result.current.meters).toBe(IDEAL_M)
    expect(result.current.source).toBe('ideal')
    expect(result.current.labelKey).toBe('idealRange')
    expect(result.current.defaultLabel).toBe('Ideal Range')
  })

  it.each(['garbage', '', 'RATED', 'Ideal', null, undefined])(
    'falls back to rated for the non-canonical preference %s',
    (pref) => {
      mockRangeType = pref
      const { result } = renderHook(() => usePreferredRange(BOTH))
      // Anything that isn't exactly the lowercase string 'ideal' is treated as
      // rated — matching the backend default and the case-sensitive contract.
      expect(result.current.source).toBe('rated')
      expect(result.current.meters).toBe(RATED_M)
      expect(result.current.labelKey).toBe('ratedRange')
    },
  )
})

describe('usePreferredRange — loading / missing data', () => {
  it('returns null meters but a stable rated label while state is null (loading)', () => {
    mockRangeType = 'rated'
    const { result } = renderHook(() => usePreferredRange(null))
    expect(result.current.meters).toBeNull()
    expect(result.current.source).toBe('rated')
    expect(result.current.labelKey).toBe('ratedRange')
    expect(result.current.defaultLabel).toBe('Rated Range')
  })

  it('returns null meters but the ideal label while state is undefined (loading)', () => {
    mockRangeType = 'ideal'
    const { result } = renderHook(() => usePreferredRange(undefined))
    expect(result.current.meters).toBeNull()
    expect(result.current.labelKey).toBe('idealRange')
    expect(result.current.defaultLabel).toBe('Ideal Range')
  })

  it('ignores a present non-selected field when the preferred one is missing', () => {
    mockRangeType = 'ideal'
    const { result } = renderHook(() => usePreferredRange({ rated_range: RATED_M }))
    // Preference is ideal but only rated_range exists → no fabricated value.
    expect(result.current.meters).toBeNull()
    expect(result.current.source).toBe('ideal')
  })

  it('reads rated_range and ignores a present ideal_range under the rated preference', () => {
    mockRangeType = 'rated'
    const { result } = renderHook(() => usePreferredRange({ ideal_range: IDEAL_M }))
    expect(result.current.meters).toBeNull()
    expect(result.current.source).toBe('rated')
  })
})

describe('usePreferredRange — numeric edge cases', () => {
  it('preserves a zero range value instead of coalescing it to null', () => {
    mockRangeType = 'rated'
    const { result } = renderHook(() => usePreferredRange({ rated_range: 0 }))
    // `0 ?? null` must stay 0 — a fully-depleted range is a real reading.
    expect(result.current.meters).toBe(0)
    expect(result.current.meters).not.toBeNull()
  })

  it('treats an explicit null field as missing', () => {
    mockRangeType = 'ideal'
    const { result } = renderHook(() => usePreferredRange({ ideal_range: null }))
    expect(result.current.meters).toBeNull()
  })
})

describe('usePreferredRange — memoisation & reactivity', () => {
  it('returns a referentially stable result across rerenders with identical inputs', () => {
    mockRangeType = 'rated'
    const { result, rerender } = renderHook(
      ({ state }: { state: PreferredRangeFields }) => usePreferredRange(state),
      { initialProps: { state: BOTH } },
    )
    const first = result.current
    rerender({ state: BOTH })
    // Same state ref + same rangeType → useMemo returns the cached object.
    expect(result.current).toBe(first)
  })

  it('recomputes when the range preference changes between renders', () => {
    mockRangeType = 'rated'
    const { result, rerender } = renderHook(
      ({ state }: { state: PreferredRangeFields }) => usePreferredRange(state),
      { initialProps: { state: BOTH } },
    )
    const rated = result.current
    expect(rated.source).toBe('rated')

    mockRangeType = 'ideal'
    rerender({ state: BOTH })
    expect(result.current).not.toBe(rated)
    expect(result.current.source).toBe('ideal')
    expect(result.current.meters).toBe(IDEAL_M)
  })

  it('recomputes when the state snapshot changes between renders', () => {
    mockRangeType = 'rated'
    const { result, rerender } = renderHook(
      ({ state }: { state: PreferredRangeFields }) => usePreferredRange(state),
      { initialProps: { state: { rated_range: RATED_M } as PreferredRangeFields } },
    )
    expect(result.current.meters).toBe(RATED_M)
    rerender({ state: { rated_range: 123_456 } })
    expect(result.current.meters).toBe(123_456)
  })
})

describe('usePreferredRange — result contract', () => {
  it('exposes exactly the documented result keys with correct types', () => {
    mockRangeType = 'ideal'
    const { result } = renderHook(() => usePreferredRange(BOTH))
    const typed: PreferredRangeResult = result.current
    expect(Object.keys(typed).sort()).toEqual([
      'defaultLabel',
      'labelKey',
      'meters',
      'source',
    ])
    expect(typeof typed.meters).toBe('number')
    expect(typeof typed.source).toBe('string')

    // Exercise the re-exported RangeType alias (compile-time + runtime).
    const src: RangeType = typed.source
    expect(['rated', 'ideal']).toContain(src)
  })
})
