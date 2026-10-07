import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getGlobalPrecision, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'
import { useCarbonDisplay } from '@/features/analytics/components/carbon-intelligence/useCarbonDisplay'
import { useSpeedSweetSpotDisplay } from '@/features/driving/components/speed-sweet-spot/useSpeedSweetSpotDisplay'

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      unit_of_length: 'km',
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      locale: 'en-US',
      decimal_precision: getGlobalPrecision(),
    },
  }),
}))

beforeEach(() => {
  setGlobalLocale('en-US')
  setGlobalPrecision(2)
})

describe('feature display precision', () => {
  it('updates mounted carbon display factories while preserving nulls, zero and clock hours', () => {
    const { result } = renderHook(() => useCarbonDisplay())
    expect(result.current.formatNumber(12.34567)).toBe('12.35')
    expect(result.current.formatPercent(80)).toBe('80.00%')
    expect(result.current.formatHour(2)).toBe('02:00')
    expect(result.current.energyValue(12345)).toBe(12.345)

    act(() => setGlobalPrecision(3))
    expect(result.current.formatNumber(12.34567)).toBe('12.346')
    expect(result.current.formatPercent(80)).toBe('80.000%')
    expect(result.current.formatNumber(0)).toBe('0.000')
    expect(result.current.formatNumber(null)).toBe('—')
    expect(result.current.formatHour(2)).toBe('02:00')
    expect(result.current.energyValue(12345)).toBe(12.345)
    expect(result.current.formatNumber(12.34567, 1)).toBe('12.3')
  })

  it('updates mounted efficiency and distance helpers without rounding their underlying conversions', () => {
    const { result } = renderHook(() => useSpeedSweetSpotDisplay())
    const efficiency = 187.456789
    expect(result.current.formatEfficiency(efficiency)).toBe('187.46 Wh/km')
    expect(result.current.formatDistance(12345.678)).toBe('12.35 km')
    expect(result.current.convertEfficiency(efficiency)).toBe(efficiency)

    act(() => setGlobalPrecision(4))
    expect(result.current.formatEfficiency(efficiency)).toBe('187.4568 Wh/km')
    expect(result.current.formatDistance(12345.678)).toBe('12.3457 km')
    expect(result.current.formatSignedEfficiency(0)).toBe('0.0000 Wh/km')
    expect(result.current.formatEfficiency(null)).toBe('—')
    expect(result.current.convertEfficiency(efficiency)).toBe(efficiency)
    expect(result.current.formatEfficiency(efficiency, 1)).toBe('187.5 Wh/km')
  })
})
