/**
 * Phase-43 / Prompt 0013 — `useUnits` SI-aware formatter tests.
 *
 * Verifies that:
 *   1. `unitPrefs` is derived correctly from `useSettings()` for both the
 *      metric (km / °C / bar) and imperial (mi / °F / psi) preference
 *      branches, including locale + precision plumbing.
 *   2. Each formatter (`formatDistance / formatSpeed / formatTemperature /
 *      formatPressure / formatEnergy / formatDuration`) delegates the
 *      actual conversion + formatting to its sibling in
 *      `@/lib/unitConversion`, with the current `unitPrefs` and any
 *      per-call `FormatOptions` passed through unmodified. The hook does
 *      no math itself.
 *   3. Formatter and `unitPrefs` references are stable across re-renders
 *      when the underlying preferences haven't changed (so memoized
 *      consumers don't re-render needlessly), and DO change when a
 *      preference flips (so consumers see the new contract).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { AppSettings } from '@/api/types'

type MockSettings = Partial<AppSettings>

let mockSettings: MockSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  locale: 'en-US',
  decimal_precision: 2,
}

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: mockSettings }),
}))

vi.mock('@/lib/unitConversion', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/unitConversion')>(
      '@/lib/unitConversion',
    )
  return {
    ...actual,
    formatDistance: vi.fn(actual.formatDistance),
    formatSpeed: vi.fn(actual.formatSpeed),
    formatTemperature: vi.fn(actual.formatTemperature),
    formatPressure: vi.fn(actual.formatPressure),
    formatEnergy: vi.fn(actual.formatEnergy),
    formatDuration: vi.fn(actual.formatDuration),
  }
})

import { useUnits } from '../useUnits'
import * as lib from '@/lib/unitConversion'

beforeEach(() => {
  mockSettings = {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    locale: 'en-US',
    decimal_precision: 2,
  }
  vi.mocked(lib.formatDistance).mockClear()
  vi.mocked(lib.formatSpeed).mockClear()
  vi.mocked(lib.formatTemperature).mockClear()
  vi.mocked(lib.formatPressure).mockClear()
  vi.mocked(lib.formatEnergy).mockClear()
  vi.mocked(lib.formatDuration).mockClear()
})

describe('useUnits — unitPrefs derivation', () => {
  it('derives metric prefs from km / C / bar settings', () => {
    const { result } = renderHook(() => useUnits())
    expect(result.current.unitPrefs).toEqual({
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      locale: 'en-US',
      precision: 2,
    })
  })

  it('derives imperial prefs from mi / F / psi settings', () => {
    mockSettings = {
      unit_of_length: 'mi',
      unit_of_temp: 'F',
      unit_of_pressure: 'psi',
      locale: 'en-GB',
      decimal_precision: 0,
    }
    const { result } = renderHook(() => useUnits())
    expect(result.current.unitPrefs).toEqual({
      distance: 'mi',
      speed: 'mph',
      temperature: '°F',
      pressure: 'psi',
      energy: 'kWh',
      duration: 'h',
      locale: 'en-GB',
      precision: 0,
    })
  })

  it('falls back to en-US locale when settings.locale is missing or blank', () => {
    mockSettings = { ...mockSettings, locale: '   ' }
    const { result: blank } = renderHook(() => useUnits())
    expect(blank.current.unitPrefs.locale).toBe('en-US')

    mockSettings = { ...mockSettings, locale: undefined }
    const { result: missing } = renderHook(() => useUnits())
    expect(missing.current.unitPrefs.locale).toBe('en-US')
  })

  it('omits precision when decimal_precision is non-finite or negative', () => {
    mockSettings = { ...mockSettings, decimal_precision: Number.NaN }
    const { result: nan } = renderHook(() => useUnits())
    expect(nan.current.unitPrefs.precision).toBeUndefined()

    mockSettings = { ...mockSettings, decimal_precision: -1 }
    const { result: neg } = renderHook(() => useUnits())
    expect(neg.current.unitPrefs.precision).toBeUndefined()
  })
})

describe('useUnits — delegation to @/lib/unitConversion', () => {
  it('formatDistance delegates to lib.formatDistance with current unitPrefs', () => {
    const { result } = renderHook(() => useUnits())
    const out = result.current.formatDistance(1609.344)
    expect(lib.formatDistance).toHaveBeenCalledTimes(1)
    expect(lib.formatDistance).toHaveBeenCalledWith(
      1609.344,
      result.current.unitPrefs,
      undefined,
    )
    // Behavioural sanity: 1609.344 m → "1.61 km" with precision=2.
    expect(out).toContain('km')
    expect(out).toContain('1.61')
  })

  it('formatSpeed delegates to lib.formatSpeed', () => {
    const { result } = renderHook(() => useUnits())
    result.current.formatSpeed(10)
    expect(lib.formatSpeed).toHaveBeenCalledTimes(1)
    expect(lib.formatSpeed).toHaveBeenCalledWith(
      10,
      result.current.unitPrefs,
      undefined,
    )
  })

  it('formatTemperature delegates to lib.formatTemperature', () => {
    const { result } = renderHook(() => useUnits())
    result.current.formatTemperature(20)
    expect(lib.formatTemperature).toHaveBeenCalledTimes(1)
    expect(lib.formatTemperature).toHaveBeenCalledWith(
      20,
      result.current.unitPrefs,
      undefined,
    )
  })

  it('formatPressure delegates to lib.formatPressure', () => {
    const { result } = renderHook(() => useUnits())
    result.current.formatPressure(220)
    expect(lib.formatPressure).toHaveBeenCalledTimes(1)
    expect(lib.formatPressure).toHaveBeenCalledWith(
      220,
      result.current.unitPrefs,
      undefined,
    )
  })

  it('formatEnergy delegates to lib.formatEnergy', () => {
    const { result } = renderHook(() => useUnits())
    result.current.formatEnergy(50_000)
    expect(lib.formatEnergy).toHaveBeenCalledTimes(1)
    expect(lib.formatEnergy).toHaveBeenCalledWith(
      50_000,
      result.current.unitPrefs,
      undefined,
    )
  })

  it('formatDuration delegates to lib.formatDuration', () => {
    const { result } = renderHook(() => useUnits())
    result.current.formatDuration(3600)
    expect(lib.formatDuration).toHaveBeenCalledTimes(1)
    expect(lib.formatDuration).toHaveBeenCalledWith(
      3600,
      result.current.unitPrefs,
      undefined,
    )
  })

  it('passes a per-call FormatOptions object straight through to the lib', () => {
    const { result } = renderHook(() => useUnits())
    const opts = { precision: 0 }
    result.current.formatDistance(1000, opts)
    expect(lib.formatDistance).toHaveBeenCalledWith(
      1000,
      result.current.unitPrefs,
      opts,
    )
  })

  it('does not invoke any lib formatter on the render itself', () => {
    renderHook(() => useUnits())
    expect(lib.formatDistance).not.toHaveBeenCalled()
    expect(lib.formatSpeed).not.toHaveBeenCalled()
    expect(lib.formatTemperature).not.toHaveBeenCalled()
    expect(lib.formatPressure).not.toHaveBeenCalled()
    expect(lib.formatEnergy).not.toHaveBeenCalled()
    expect(lib.formatDuration).not.toHaveBeenCalled()
  })
})

describe('useUnits — reference stability', () => {
  it('returns identical formatter and unitPrefs references when prefs are unchanged', () => {
    const { result, rerender } = renderHook(() => useUnits())
    const first = {
      unitPrefs: result.current.unitPrefs,
      formatDistance: result.current.formatDistance,
      formatSpeed: result.current.formatSpeed,
      formatTemperature: result.current.formatTemperature,
      formatPressure: result.current.formatPressure,
      formatEnergy: result.current.formatEnergy,
      formatDuration: result.current.formatDuration,
    }
    rerender()
    expect(result.current.unitPrefs).toBe(first.unitPrefs)
    expect(result.current.formatDistance).toBe(first.formatDistance)
    expect(result.current.formatSpeed).toBe(first.formatSpeed)
    expect(result.current.formatTemperature).toBe(first.formatTemperature)
    expect(result.current.formatPressure).toBe(first.formatPressure)
    expect(result.current.formatEnergy).toBe(first.formatEnergy)
    expect(result.current.formatDuration).toBe(first.formatDuration)
  })

  it('rebuilds formatters when the distance preference flips', () => {
    const { result, rerender } = renderHook(() => useUnits())
    const firstDistance = result.current.formatDistance
    const firstSpeed = result.current.formatSpeed
    mockSettings = { ...mockSettings, unit_of_length: 'mi' }
    rerender()
    expect(result.current.unitPrefs.distance).toBe('mi')
    expect(result.current.unitPrefs.speed).toBe('mph')
    expect(result.current.formatDistance).not.toBe(firstDistance)
    expect(result.current.formatSpeed).not.toBe(firstSpeed)
  })

  it('rebuilds formatters when the temperature preference flips', () => {
    const { result, rerender } = renderHook(() => useUnits())
    const firstTemp = result.current.formatTemperature
    mockSettings = { ...mockSettings, unit_of_temp: 'F' }
    rerender()
    expect(result.current.unitPrefs.temperature).toBe('°F')
    expect(result.current.formatTemperature).not.toBe(firstTemp)
  })

  it('rebuilds formatters when the pressure preference flips', () => {
    const { result, rerender } = renderHook(() => useUnits())
    const firstPressure = result.current.formatPressure
    mockSettings = { ...mockSettings, unit_of_pressure: 'psi' }
    rerender()
    expect(result.current.unitPrefs.pressure).toBe('psi')
    expect(result.current.formatPressure).not.toBe(firstPressure)
  })

  it('rebuilds formatters when locale or precision changes', () => {
    const { result, rerender } = renderHook(() => useUnits())
    const firstPrefs = result.current.unitPrefs
    mockSettings = { ...mockSettings, locale: 'fr-FR' }
    rerender()
    expect(result.current.unitPrefs).not.toBe(firstPrefs)
    expect(result.current.unitPrefs.locale).toBe('fr-FR')

    const afterLocalePrefs = result.current.unitPrefs
    mockSettings = { ...mockSettings, decimal_precision: 0 }
    rerender()
    expect(result.current.unitPrefs).not.toBe(afterLocalePrefs)
    expect(result.current.unitPrefs.precision).toBe(0)
  })
})
