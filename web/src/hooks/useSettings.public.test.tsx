import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { UnitPref } from '@/lib/unitConversion'

vi.mock('@/hooks/useSettings', async () =>
  await vi.importActual<typeof import('./useSettings')>('./useSettings'),
)
vi.mock('@/api/settings', () => ({ getSettings: vi.fn() }))
vi.mock('@/lib/broadcast', () => ({ subscribe: vi.fn() }))
vi.mock('@/lib/numberFormat', async () => ({
  ...await vi.importActual<typeof import('@/lib/numberFormat')>('@/lib/numberFormat'),
  subscribeFormatterPreferences: vi.fn(),
}))

import { usePublicDisplayFormatting } from './useSettings'
import { getSettings } from '@/api/settings'
import { subscribe } from '@/lib/broadcast'
import {
  getGlobalLocale, getGlobalPrecision, setGlobalLocale, setGlobalPrecision,
  subscribeFormatterPreferences,
} from '@/lib/numberFormat'

afterEach(() => {
  cleanup()
  setGlobalLocale('en-US')
  setGlobalPrecision(2)
  vi.clearAllMocks()
})

describe('public report formatting context', () => {
  it('formats populated SI data without authenticated reads, subscriptions, storage or global preferences', () => {
    setGlobalLocale('de-DE')
    setGlobalPrecision(5)
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const { result, rerender } = renderHook(() => usePublicDisplayFormatting())
    const original = result.current

    expect(original.unitPrefs).toMatchObject({ distance: 'km', locale: 'en-US', precision: 2 })
    expect(original.formatDistance(12345)).toBe('12.35 km')
    expect(original.formatSpeed(10)).toBe('36.00 km/h')
    expect(original.formatEnergy(45000)).toBe('45.00 kWh')
    expect(original.formatPower(250000)).toBe('250.00 kW')
    expect(original.fmtNumber(1234.567)).toBe('1,234.57')
    act(() => {
      setGlobalLocale('fr-FR')
      setGlobalPrecision(0)
    })
    rerender()
    expect(result.current).toBe(original)
    expect(result.current.fmtNumber(1234.567)).toBe('1,234.57')
    expect(getGlobalLocale()).toBe('fr-FR')
    expect(getGlobalPrecision()).toBe(0)
    expect(getSettings).not.toHaveBeenCalled()
    expect(subscribe).not.toHaveBeenCalled()
    expect(subscribeFormatterPreferences).not.toHaveBeenCalled()
    expect(storage).not.toHaveBeenCalled()
    storage.mockRestore()
  })

  it('reacts to an explicitly supplied imperial, locale and precision context while retaining SI inputs', () => {
    const metric: UnitPref = {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US', precision: 2,
    }
    const { result, rerender } = renderHook(
      ({ context }) => usePublicDisplayFormatting(context),
      { initialProps: { context: metric } },
    )
    const rawDistance = 1609.344
    expect(result.current.formatDistance(rawDistance)).toBe('1.61 km')
    rerender({ context: { ...metric, distance: 'mi', speed: 'mph', locale: 'de-DE', precision: 3 } })
    expect(result.current.formatDistance(rawDistance)).toBe('1,000 mi')
    expect(result.current.fmtNumber(1234.5678)).toBe('1.234,568')
    expect(result.current.formatSpeed(10, { precision: 1 })).toBe('22,4 mph')
    expect(rawDistance).toBe(1609.344)
  })

  it('keeps zero distinct from missing measurements and normalizes unsafe precision and empty locale', () => {
    const { result } = renderHook(() => usePublicDisplayFormatting({
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
      energy: 'kWh', duration: 'h', power: 'kW', locale: '', precision: Number.NaN,
    }))
    expect(result.current.unitPrefs).toMatchObject({ locale: 'en-US', precision: 2 })
    expect(result.current.formatDistance(0)).toBe('0.00 km')
    expect(result.current.formatDistance(null)).toBe('\u2014')
    expect(result.current.formatPower(undefined)).toBe('\u2014')
  })
})
