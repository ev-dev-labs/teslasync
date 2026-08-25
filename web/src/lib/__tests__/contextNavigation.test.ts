import { describe, expect, it } from 'vitest'
import { buildContextHref } from '../contextNavigation'

describe('buildContextHref', () => {
  it('encodes entity and time context', () => {
    expect(buildContextHref('/signals', {
      from: '2026-08-20',
      to: '2026-08-21',
      signals: ['BatteryLevel', 'VehicleSpeed'],
    })).toBe(
      '/signals?from=2026-08-20&to=2026-08-21&signals=BatteryLevel%2CVehicleSpeed',
    )
  })

  it('omits unavailable values and empty collections', () => {
    expect(buildContextHref('/locations', {
      q: 'Home & Office',
      from: null,
      to: undefined,
      signals: [],
    })).toBe('/locations?q=Home+%26+Office')
  })
})
