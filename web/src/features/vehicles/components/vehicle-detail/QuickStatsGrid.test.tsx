// Behavioural coverage for QuickStatsGrid — the eight-tile KPI band on the
// vehicle detail view. It is a pure prop-driven presenter over a VehicleState
// (+ derived VehicleStatus), so the contract worth pinning is:
//   - the battery tile routing SoC through `formatBatteryLevel` (falsy 0% shown
//     verbatim, null/undefined/NaN → em-dash, never "null%"), with the accent
//     from `batteryColor` (>50 green, >20 cyan, <=20 red — the regression the
//     original `? 'cyan' : 'cyan'` ternary masked),
//   - range / odometer routed through the useUnits distance formatter and speed
//     through the speed formatter, at precision 0, with the exact SI value,
//   - both temperature tiles through the temperature formatter incl. the falsy
//     0 °C an `||` bug would swallow,
//   - the speed tile's Driving/Parked subtitle flipping on speed > 0,
//   - power formatted as "<n> kW" for finite values and an em-dash when missing
//     (so an unknown power never masquerades as a real 0.00 kW reading),
//   - the state tile echoing the status, degrading to an em-dash if it is blank,
//   - every visible label resolved through i18n (no raw English literals), and
//   - a11y: every decorative glyph is aria-hidden.
//
// react-i18next is mocked so `t(key, fallback)` returns the English fallback AND
// records the exact key/fallback each string wires to (mirrors the sibling
// ClimateSection test). useUnits is mocked with echo formatters so the precise
// SI value + options routed to each formatter is provable, with no unit maths in
// the test. The real MetricCard renders, proving the tiles + their colour rings
// mount. Nothing here touches the network — QuickStatsGrid receives its data as
// props. The pure helpers (batteryColor / formatBatteryLevel) are also unit
// tested directly so every export is covered.

import type { ReactNode } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { mockT, formatDistance, formatSpeed, formatTemperature } = vi.hoisted(() => ({
  mockT: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
  // Mirror the real lib formatters: nullish/NaN → em-dash, else an echo with the
  // unit suffix so the exact SI value routed to each tile is provable.
  formatDistance: vi.fn((v: number | null | undefined) =>
    v == null || Number.isNaN(v) ? '—' : `${v} km`,
  ),
  formatSpeed: vi.fn((v: number | null | undefined) =>
    v == null || Number.isNaN(v) ? '—' : `${v} km/h`,
  ),
  formatTemperature: vi.fn((v: number | null | undefined) =>
    v == null || Number.isNaN(v) ? '—' : `${v}°C`,
  ),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDistance, formatSpeed, formatTemperature }),
}))

import { QuickStatsGrid, batteryColor, formatBatteryLevel } from './QuickStatsGrid'
import type { VehicleState, VehicleStatus } from '@/api/types'

// A fully-populated live state with distinctive SI magnitudes so each tile's
// routed value is unambiguous in assertions.
const fullState: VehicleState = {
  vehicle_id: 1,
  state: 'online',
  latitude: 0,
  longitude: 0,
  heading: null,
  speed: 25,
  power: 45.5,
  battery_level: 72,
  rated_range: 320000,
  ideal_range: 340000,
  odometer: 15000000,
  inside_temp: 21,
  outside_temp: 8,
  is_climate_on: false,
  is_charging: false,
  charger_power: 0,
  charge_rate: 0,
  time_to_full_charge: 0,
  is_locked: true,
  sentry_mode: false,
  software_version: '2025.1',
}

function renderGrid(
  overrides: Partial<Record<keyof VehicleState, unknown>> = {},
  status: VehicleStatus = 'driving',
) {
  const state = { ...fullState, ...overrides } as VehicleState
  return render(<QuickStatsGrid state={state} status={status} />)
}

beforeEach(() => {
  mockT.mockClear()
  formatDistance.mockClear()
  formatSpeed.mockClear()
  formatTemperature.mockClear()
})
afterEach(cleanup)

describe('batteryColor', () => {
  it('maps a healthy pack (>50%) to green', () => {
    expect(batteryColor(72)).toBe('green')
    expect(batteryColor(51)).toBe('green')
    expect(batteryColor(100)).toBe('green')
  })

  it('maps a mid charge (20% < level <= 50%) to neutral cyan', () => {
    expect(batteryColor(50)).toBe('cyan')
    expect(batteryColor(35)).toBe('cyan')
    expect(batteryColor(21)).toBe('cyan')
  })

  it('maps a low charge (<=20%) to red — the tier the original ternary lost', () => {
    // Regression: the source used `> 20 ? 'cyan' : 'cyan'`, so a critical pack
    // rendered identically to a comfortable-ish one. It must now read red.
    expect(batteryColor(20)).toBe('red')
    expect(batteryColor(5)).toBe('red')
    expect(batteryColor(0)).toBe('red')
  })

  it('falls back to neutral cyan for unknown / non-finite levels', () => {
    expect(batteryColor(null)).toBe('cyan')
    expect(batteryColor(undefined)).toBe('cyan')
    expect(batteryColor(NaN)).toBe('cyan')
    expect(batteryColor(Infinity)).toBe('cyan')
  })
})

describe('formatBatteryLevel', () => {
  it('appends a percent sign to a finite level, including the falsy 0', () => {
    expect(formatBatteryLevel(72)).toBe('72%')
    expect(formatBatteryLevel(0)).toBe('0%')
  })

  it('renders an em-dash for missing / non-finite levels (never "null%")', () => {
    expect(formatBatteryLevel(null)).toBe('—')
    expect(formatBatteryLevel(undefined)).toBe('—')
    expect(formatBatteryLevel(NaN)).toBe('—')
  })
})

describe('QuickStatsGrid', () => {
  it('renders all eight KPI tiles with their labels and formatted values', () => {
    renderGrid()

    for (const label of [
      'Battery',
      'Range',
      'Odometer',
      'Speed',
      'Inside Temp',
      'Outside Temp',
      'Power',
      'State',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }

    // Battery routed through formatBatteryLevel.
    expect(screen.getByText('72%')).toBeInTheDocument()
    // Power formatted with the kW suffix at global precision (2).
    expect(screen.getByText('45.50 kW')).toBeInTheDocument()
    // Status echoed into the State tile.
    expect(screen.getByText('driving')).toBeInTheDocument()
  })

  it('routes distance + speed + temperature tiles through the useUnits formatters with SI values at precision 0', () => {
    renderGrid()

    // rated_range and odometer both go through the distance formatter.
    expect(formatDistance).toHaveBeenCalledWith(320000, { precision: 0 })
    expect(formatDistance).toHaveBeenCalledWith(15000000, { precision: 0 })
    expect(formatSpeed).toHaveBeenCalledWith(25, { precision: 0 })
    expect(formatTemperature).toHaveBeenCalledWith(21)
    expect(formatTemperature).toHaveBeenCalledWith(8)

    // The echoed formatter output is what actually renders.
    expect(screen.getByText('320000 km')).toBeInTheDocument()
    expect(screen.getByText('15000000 km')).toBeInTheDocument()
    expect(screen.getByText('25 km/h')).toBeInTheDocument()
    expect(screen.getByText('21°C')).toBeInTheDocument()
    expect(screen.getByText('8°C')).toBeInTheDocument()
  })

  it('renders a 0 °C temperature verbatim — the formatter guard must not swallow the falsy 0', () => {
    renderGrid({ inside_temp: 0 })
    expect(formatTemperature).toHaveBeenCalledWith(0)
    expect(screen.getByText('0°C')).toBeInTheDocument()
  })

  it('shows the Driving subtitle when moving and Parked when stopped', () => {
    renderGrid({ speed: 42 })
    expect(screen.getByText('Driving')).toBeInTheDocument()
    expect(screen.queryByText('Parked')).toBeNull()
    expect(mockT).toHaveBeenCalledWith('common.driving', 'Driving')

    cleanup()
    mockT.mockClear()

    renderGrid({ speed: 0 })
    expect(screen.getByText('Parked')).toBeInTheDocument()
    expect(screen.queryByText('Driving')).toBeNull()
    expect(mockT).toHaveBeenCalledWith('common.parked', 'Parked')
  })

  it('applies the red accent ring only when the battery is critical (<=20%)', () => {
    const { container } = renderGrid({ battery_level: 12 })
    // Battery is the only tile that can go red, so its presence pins the accent.
    expect(container.querySelector('[class*="bg-neon-red"]')).not.toBeNull()
    expect(screen.getByText('12%')).toBeInTheDocument()

    cleanup()

    const healthy = renderGrid({ battery_level: 88 })
    expect(healthy.container.querySelector('[class*="bg-neon-red"]')).toBeNull()
    // A healthy pack lights the green accent instead.
    expect(healthy.container.querySelector('[class*="bg-neon-green"]')).not.toBeNull()
  })

  it('degrades missing numeric readings to an em-dash instead of "null%" / "0.00 kW" / a blank tile', () => {
    expect(() =>
      renderGrid({ battery_level: null, power: null }),
    ).not.toThrow()

    // Battery + power both collapse to the em-dash placeholder…
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    // …never the literal broken strings.
    expect(screen.queryByText('null%')).toBeNull()
    expect(screen.queryByText('0.00 kW')).toBeNull()
    // The battery tile with an unknown level uses the neutral (non-red) accent.
    expect(document.querySelector('[class*="bg-neon-red"]')).toBeNull()
  })

  it('renders a 0% battery verbatim with the red critical accent (not an em-dash)', () => {
    const { container } = renderGrid({ battery_level: 0 })
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(container.querySelector('[class*="bg-neon-red"]')).not.toBeNull()
  })

  it('falls back to an em-dash when the status is blank (never a blank State tile)', () => {
    renderGrid({}, '' as VehicleStatus)
    // The State label is still present with an em-dash value.
    expect(screen.getByText('State')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('wires every tile label to its i18n key (no raw English labels)', () => {
    renderGrid()

    const expected: ReadonlyArray<readonly [string, string]> = [
      ['common.battery', 'Battery'],
      ['common.range', 'Range'],
      ['common.odometer', 'Odometer'],
      ['common.speed', 'Speed'],
      ['common.insideTemp', 'Inside Temp'],
      ['common.outsideTemp', 'Outside Temp'],
      ['common.power', 'Power'],
      ['common.state', 'State'],
    ]
    for (const [key, fallback] of expected) {
      expect(mockT).toHaveBeenCalledWith(key, fallback)
    }
  })

  it('marks every decorative glyph aria-hidden', () => {
    const { container } = renderGrid()

    const svgs = Array.from(container.querySelectorAll('svg'))
    // One glyph per tile = eight decorative icons.
    expect(svgs.length).toBeGreaterThanOrEqual(8)
    for (const svg of svgs) {
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    }
  })
})
