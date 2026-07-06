/**
 * `usePressureFormat` bridge-hook tests.
 *
 * `usePressureFormat` reconciles the ONE unit-system impedance mismatch on
 * the pressure path: the Tesla telemetry pipeline persists pressure in
 * Pascals (SI on disk) and the API returns it verbatim (e.g. `220000` for
 * 2.2 bar), while `@/lib/unitConversion` converters operate on the
 * kilopascal SI-floor (`SI.pressure === 'kPa'`). The hook exposes TWO
 * projections of the same Pascals source — a numeric `toPressureValue`
 * (for Recharts axes / reference lines) and a formatted `formatPressureValue`
 * (for tooltips / chips) — and its whole reason for existing is that the two
 * MUST agree.
 *
 * Strategy mirrors `useUnits.test.tsx` / `useAiEnabled.test.tsx`: mock the
 * lower `useSettings` hook and drive the REAL `useUnits` + REAL
 * `@/lib/unitConversion`, so the actual Pascals→kilopascals→display math is
 * exercised end-to-end. That is what surfaces the historical 1000x bug
 * (a raw Pascals value forwarded straight into the kPa-expecting lib).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { AppSettings } from '@/api/types'

type MockSettings = Partial<AppSettings>

// 220000 Pa == 220 kPa == 2.2 bar == ~31.9086 psi. Used throughout as the
// canonical "healthy front tire" reading straight off the wire.
const PA_2_2_BAR = 220_000

let mockSettings: MockSettings = {
  unit_of_pressure: 'bar',
  locale: 'en-US',
  decimal_precision: 2,
}

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: mockSettings }),
}))

import { usePressureFormat } from './usePressureFormat'

beforeEach(() => {
  mockSettings = {
    unit_of_pressure: 'bar',
    locale: 'en-US',
    decimal_precision: 2,
  }
})

describe('usePressureFormat — pressureUnit derivation', () => {
  it('surfaces the bar preference', () => {
    const { result } = renderHook(() => usePressureFormat())
    expect(result.current.pressureUnit).toBe('bar')
  })

  it('surfaces the psi preference', () => {
    mockSettings = { ...mockSettings, unit_of_pressure: 'psi' }
    const { result } = renderHook(() => usePressureFormat())
    expect(result.current.pressureUnit).toBe('psi')
  })
})

describe('usePressureFormat — toPressureValue (Pascals → number)', () => {
  it('converts a raw API Pascals value to bar (220000 Pa → 2.2 bar)', () => {
    const { result } = renderHook(() => usePressureFormat())
    expect(result.current.toPressureValue(PA_2_2_BAR)).toBeCloseTo(2.2, 6)
  })

  it('does NOT inflate the value 1000x — the historical kPa-vs-Pa bug', () => {
    // Before the Pa→kPa bridge, `convertPressureFromSI(220000, 'bar')`
    // returned 2200 (Pascals treated as kilopascals). Guard the fix so a
    // regression is caught the instant the divisor is dropped.
    const { result } = renderHook(() => usePressureFormat())
    const bar = result.current.toPressureValue(PA_2_2_BAR)
    expect(bar).not.toBeNull()
    expect(bar as number).toBeLessThan(100)
    expect(bar).not.toBeCloseTo(2200, 0)
  })

  it('converts a raw API Pascals value to psi (220000 Pa → ~31.9086 psi)', () => {
    mockSettings = { ...mockSettings, unit_of_pressure: 'psi' }
    const { result } = renderHook(() => usePressureFormat())
    // 220 kPa / 6.894757 kPa-per-psi ≈ 31.9086 psi.
    expect(result.current.toPressureValue(PA_2_2_BAR)).toBeCloseTo(31.9086, 3)
  })

  it('maps zero Pascals to zero without dividing to NaN', () => {
    const { result } = renderHook(() => usePressureFormat())
    expect(result.current.toPressureValue(0)).toBe(0)
  })

  it('returns null for null / undefined / NaN / ±Infinity', () => {
    const { result } = renderHook(() => usePressureFormat())
    expect(result.current.toPressureValue(null)).toBeNull()
    expect(result.current.toPressureValue(undefined)).toBeNull()
    expect(result.current.toPressureValue(Number.NaN)).toBeNull()
    expect(result.current.toPressureValue(Number.POSITIVE_INFINITY)).toBeNull()
    expect(result.current.toPressureValue(Number.NEGATIVE_INFINITY)).toBeNull()
  })
})

describe('usePressureFormat — formatPressureValue (Pascals → string)', () => {
  it('formats a Pascals source with the bar suffix and user precision', () => {
    const { result } = renderHook(() => usePressureFormat())
    expect(result.current.formatPressureValue(PA_2_2_BAR)).toBe('2.20 bar')
  })

  it('formats a Pascals source with the psi suffix', () => {
    mockSettings = { ...mockSettings, unit_of_pressure: 'psi' }
    const { result } = renderHook(() => usePressureFormat())
    expect(result.current.formatPressureValue(PA_2_2_BAR)).toBe('31.91 psi')
  })

  it('honours a per-call precision override', () => {
    const { result } = renderHook(() => usePressureFormat())
    expect(result.current.formatPressureValue(PA_2_2_BAR, { precision: 0 })).toBe('2 bar')
  })

  it('falls back to the empty display for null / undefined / NaN', () => {
    const { result } = renderHook(() => usePressureFormat())
    expect(result.current.formatPressureValue(null)).toBe('—')
    expect(result.current.formatPressureValue(undefined)).toBe('—')
    expect(result.current.formatPressureValue(Number.NaN)).toBe('—')
  })
})

describe('usePressureFormat — the two projections agree on one source', () => {
  it('numeric value and formatted string describe the same converted number', () => {
    const { result } = renderHook(() => usePressureFormat())
    const pa = 250_000 // 2.5 bar
    const num = result.current.toPressureValue(pa)
    const str = result.current.formatPressureValue(pa)
    expect(num).toBeCloseTo(2.5, 6)
    expect(str).toBe('2.50 bar')
    // The formatted string's numeric head matches the numeric projection.
    expect(str).toContain((num as number).toFixed(1))
  })
})

describe('usePressureFormat — reference stability & pref reactivity', () => {
  it('returns stable references across a re-render when prefs are unchanged', () => {
    const { result, rerender } = renderHook(() => usePressureFormat())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    expect(result.current.toPressureValue).toBe(first.toPressureValue)
    expect(result.current.formatPressureValue).toBe(first.formatPressureValue)
  })

  it('rebuilds both projections and re-converts when the pressure pref flips', () => {
    const { result, rerender } = renderHook(() => usePressureFormat())
    const firstToValue = result.current.toPressureValue
    const firstFormat = result.current.formatPressureValue
    expect(result.current.toPressureValue(PA_2_2_BAR)).toBeCloseTo(2.2, 6)

    mockSettings = { ...mockSettings, unit_of_pressure: 'psi' }
    rerender()

    expect(result.current.pressureUnit).toBe('psi')
    expect(result.current.toPressureValue).not.toBe(firstToValue)
    expect(result.current.formatPressureValue).not.toBe(firstFormat)
    expect(result.current.toPressureValue(PA_2_2_BAR)).toBeCloseTo(31.9086, 3)
    expect(result.current.formatPressureValue(PA_2_2_BAR)).toBe('31.91 psi')
  })
})
