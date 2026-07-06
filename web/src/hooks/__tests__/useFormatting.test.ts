/**
 * `useFormatting` currency / cost formatting tests.
 *
 * `useFormatting` is the render-boundary bridge that turns the user's cost
 * settings (electricity rate, currency symbol, decimal precision, gas
 * economy) into display strings and per-distance/per-trip cost estimates.
 * It reads SI meters and converts at the boundary via `convertDistanceFromSI`.
 *
 * These tests cover the whole public surface returned by the hook:
 *   - `costPerKwh` / `currencySymbol` derivation + defaults
 *   - `formatEnergyCost` (rate × kWh, symbol, precision, NaN-safety)
 *   - `formatCurrency` (grouping, per-call precision override, out-of-range
 *     clamp, negative/NaN fallback)
 *   - `costPerDistanceUnit` (SI→display distance, null on non-positive /
 *     non-finite inputs, reacts to the distance-unit preference)
 *   - `estimateGasCost` (gallon + liter branches, guard rails, defaults)
 *   - reference stability / memoisation of the returned callbacks
 *
 * `useSettings` is mocked per-file (overriding the global stub in
 * `test-setup.ts`) so each test can drive bespoke settings. `useUnits` is the
 * real hook — it reads the same mocked settings — so the distance-unit
 * preference flows through end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { AppSettings } from '@/api/types'
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'

type MockSettings = Partial<AppSettings>

const BASE: MockSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  locale: 'en-US',
  decimal_precision: 2,
  base_cost_per_kwh: 0.2,
  currency_symbol: '$',
  gas_efficiency_mpg: 25,
  gas_price_per_unit: 4,
  gas_unit: 'gallon',
}

let mockSettings: MockSettings = { ...BASE }

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: mockSettings }),
}))

import { useFormatting, type UseFormattingResult } from '../useFormatting'

/** 100 miles expressed in SI meters (1 mi = 1609.344 m exactly). */
const HUNDRED_MILES_M = 100 * 1609.344
/** 100 kilometres expressed in SI meters. */
const HUNDRED_KM_M = 100_000

beforeEach(() => {
  mockSettings = { ...BASE }
  // fmtNumber reads a module-global locale/precision; pin them so number
  // grouping + separators are deterministic regardless of test ordering.
  setGlobalLocale('en-US')
  setGlobalPrecision(2)
})

describe('useFormatting — derived scalars', () => {
  it('exposes the configured electricity rate and currency symbol', () => {
    const { result } = renderHook(() => useFormatting())
    expect(result.current.costPerKwh).toBe(0.2)
    expect(result.current.currencySymbol).toBe('$')

    // Interface coverage: the result satisfies the exported contract.
    const typed: UseFormattingResult = result.current
    expect(typeof typed.formatEnergyCost).toBe('function')
    expect(typeof typed.formatCurrency).toBe('function')
    expect(typeof typed.costPerDistanceUnit).toBe('function')
    expect(typeof typed.estimateGasCost).toBe('function')
  })

  it('defaults costPerKwh to 0.12 when base_cost_per_kwh is absent', () => {
    mockSettings = { ...BASE, base_cost_per_kwh: undefined }
    const { result } = renderHook(() => useFormatting())
    expect(result.current.costPerKwh).toBe(0.12)
    expect(result.current.formatEnergyCost(1)).toBe('$0.12')
  })

  it('falls back to "$" when currency_symbol is missing or whitespace-only', () => {
    mockSettings = { ...BASE, currency_symbol: undefined }
    const { result: missing } = renderHook(() => useFormatting())
    expect(missing.current.currencySymbol).toBe('$')

    mockSettings = { ...BASE, currency_symbol: '   ' }
    const { result: blank } = renderHook(() => useFormatting())
    expect(blank.current.currencySymbol).toBe('$')
  })
})

describe('useFormatting — formatEnergyCost', () => {
  it('multiplies kWh by the rate and prefixes the currency symbol', () => {
    const { result } = renderHook(() => useFormatting())
    expect(result.current.formatEnergyCost(10)).toBe('$2.00') // 10 × $0.2
    expect(result.current.formatEnergyCost(0)).toBe('$0.00')
    expect(result.current.formatEnergyCost(2.5)).toBe('$0.50')
  })

  it('honours the currency symbol and decimal precision from settings', () => {
    mockSettings = { ...BASE, currency_symbol: '€', decimal_precision: 0 }
    const { result } = renderHook(() => useFormatting())
    expect(result.current.formatEnergyCost(10)).toBe('€2') // 2 at 0 decimals
  })

  it('never emits "NaN" for a non-finite kWh input', () => {
    const { result } = renderHook(() => useFormatting())
    const out = result.current.formatEnergyCost(Number.NaN)
    expect(out).not.toContain('NaN')
    expect(out.startsWith('$')).toBe(true)
  })
})

describe('useFormatting — formatCurrency', () => {
  it('formats with locale grouping at the default precision', () => {
    const { result } = renderHook(() => useFormatting())
    expect(result.current.formatCurrency(1234.5)).toBe('$1,234.50')
  })

  it('accepts a per-call decimals override (including zero)', () => {
    const { result } = renderHook(() => useFormatting())
    expect(result.current.formatCurrency(1.23456, 3)).toBe('$1.235')
    expect(result.current.formatCurrency(5, 0)).toBe('$5')
  })

  it('clamps an out-of-range precision instead of throwing RangeError', () => {
    const { result } = renderHook(() => useFormatting())
    // 200 fraction digits would throw out of Intl.NumberFormat; the hook
    // clamps to the spec-safe maximum of 20.
    const out = result.current.formatCurrency(5, 200)
    expect(out.startsWith('$5')).toBe(true)
    expect((out.split('.')[1] ?? '').length).toBe(20)
  })

  it('falls back to the user precision for negative or NaN decimals', () => {
    const { result } = renderHook(() => useFormatting())
    expect(result.current.formatCurrency(5, -1)).toBe('$5.00')
    expect(result.current.formatCurrency(5, Number.NaN)).toBe('$5.00')
  })
})

describe('useFormatting — costPerDistanceUnit', () => {
  it('divides energy cost by the converted distance (km preference)', () => {
    const { result } = renderHook(() => useFormatting())
    // 10 kWh × $0.2 = $2 spread over 100 km → $0.02 / km
    expect(result.current.costPerDistanceUnit(10, HUNDRED_KM_M)).toBeCloseTo(0.02, 6)
  })

  it('returns null for zero or negative distance', () => {
    const { result } = renderHook(() => useFormatting())
    expect(result.current.costPerDistanceUnit(10, 0)).toBeNull()
    expect(result.current.costPerDistanceUnit(10, -100)).toBeNull()
  })

  it('returns null (not NaN) for non-finite inputs', () => {
    const { result } = renderHook(() => useFormatting())
    expect(result.current.costPerDistanceUnit(Number.NaN, HUNDRED_KM_M)).toBeNull()
    expect(result.current.costPerDistanceUnit(10, Number.NaN)).toBeNull()
    expect(result.current.costPerDistanceUnit(10, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('reacts to the distance-unit preference (km vs mi) for the same SI input', () => {
    const { result, rerender } = renderHook(() => useFormatting())
    const firstFn = result.current.costPerDistanceUnit
    const kmCost = result.current.costPerDistanceUnit(10, HUNDRED_KM_M)

    mockSettings = { ...BASE, unit_of_length: 'mi' }
    rerender()
    const miCost = result.current.costPerDistanceUnit(10, HUNDRED_KM_M)

    expect(result.current.costPerDistanceUnit).not.toBe(firstFn)
    expect(kmCost).toBeCloseTo(0.02, 6) // $2 / 100 km
    expect(miCost).toBeCloseTo(0.03218688, 6) // $2 / 62.137 mi
  })
})

describe('useFormatting — estimateGasCost', () => {
  it('estimates cost per gallon for an SI-meter distance', () => {
    const { result } = renderHook(() => useFormatting())
    // 100 mi ÷ 25 mpg = 4 gal × $4/gal = $16
    expect(result.current.estimateGasCost(HUNDRED_MILES_M)).toBeCloseTo(16, 5)
  })

  it('converts gallons to liters when gas_unit is "liter"', () => {
    mockSettings = { ...BASE, gas_unit: 'liter' }
    const { result } = renderHook(() => useFormatting())
    // 4 gal × 3.78541 L/gal × $4/L = $60.56656
    expect(result.current.estimateGasCost(HUNDRED_MILES_M)).toBeCloseTo(60.56656, 4)
  })

  it('defaults an absent gas_unit to gallons', () => {
    mockSettings = { ...BASE, gas_unit: undefined }
    const { result } = renderHook(() => useFormatting())
    expect(result.current.estimateGasCost(HUNDRED_MILES_M)).toBeCloseTo(16, 5)
  })

  it('returns null when mpg, price, or distance is non-positive', () => {
    const { result: base } = renderHook(() => useFormatting())
    expect(base.current.estimateGasCost(0)).toBeNull()

    mockSettings = { ...BASE, gas_efficiency_mpg: 0 }
    const { result: noMpg } = renderHook(() => useFormatting())
    expect(noMpg.current.estimateGasCost(HUNDRED_MILES_M)).toBeNull()

    mockSettings = { ...BASE, gas_price_per_unit: 0 }
    const { result: noPrice } = renderHook(() => useFormatting())
    expect(noPrice.current.estimateGasCost(HUNDRED_MILES_M)).toBeNull()
  })

  it('returns null (not NaN) for non-finite mpg or distance', () => {
    mockSettings = { ...BASE, gas_efficiency_mpg: Number.NaN }
    const { result: nanMpg } = renderHook(() => useFormatting())
    expect(nanMpg.current.estimateGasCost(HUNDRED_MILES_M)).toBeNull()

    mockSettings = { ...BASE }
    const { result: nanDist } = renderHook(() => useFormatting())
    expect(nanDist.current.estimateGasCost(Number.NaN)).toBeNull()
    expect(nanDist.current.estimateGasCost(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('useFormatting — reference stability & memoisation', () => {
  it('returns a stable object + stable callbacks across rerenders when settings are unchanged', () => {
    const { result, rerender } = renderHook(() => useFormatting())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    expect(result.current.formatEnergyCost).toBe(first.formatEnergyCost)
    expect(result.current.formatCurrency).toBe(first.formatCurrency)
    expect(result.current.costPerDistanceUnit).toBe(first.costPerDistanceUnit)
    expect(result.current.estimateGasCost).toBe(first.estimateGasCost)
  })

  it('rebuilds only rate-dependent callbacks when base_cost_per_kwh changes', () => {
    const { result, rerender } = renderHook(() => useFormatting())
    const first = result.current
    mockSettings = { ...BASE, base_cost_per_kwh: 0.5 }
    rerender()
    expect(result.current.costPerKwh).toBe(0.5)
    expect(result.current.formatEnergyCost).not.toBe(first.formatEnergyCost)
    expect(result.current.costPerDistanceUnit).not.toBe(first.costPerDistanceUnit)
    // Currency + gas callbacks do not depend on the electricity rate.
    expect(result.current.formatCurrency).toBe(first.formatCurrency)
    expect(result.current.estimateGasCost).toBe(first.estimateGasCost)
  })

  it('rebuilds currency callbacks when the currency symbol changes', () => {
    const { result, rerender } = renderHook(() => useFormatting())
    const first = result.current
    mockSettings = { ...BASE, currency_symbol: '€' }
    rerender()
    expect(result.current.currencySymbol).toBe('€')
    expect(result.current.formatCurrency).not.toBe(first.formatCurrency)
    expect(result.current.formatEnergyCost).not.toBe(first.formatEnergyCost)
    expect(result.current.costPerDistanceUnit).toBe(first.costPerDistanceUnit)
    expect(result.current.estimateGasCost).toBe(first.estimateGasCost)
    expect(result.current.formatCurrency(10)).toBe('€10.00')
  })

  it('rebuilds only estimateGasCost when a gas setting changes', () => {
    const { result, rerender } = renderHook(() => useFormatting())
    const first = result.current
    mockSettings = { ...BASE, gas_price_per_unit: 8 }
    rerender()
    expect(result.current.estimateGasCost).not.toBe(first.estimateGasCost)
    expect(result.current.formatCurrency).toBe(first.formatCurrency)
    expect(result.current.formatEnergyCost).toBe(first.formatEnergyCost)
    expect(result.current.costPerDistanceUnit).toBe(first.costPerDistanceUnit)
  })
})
