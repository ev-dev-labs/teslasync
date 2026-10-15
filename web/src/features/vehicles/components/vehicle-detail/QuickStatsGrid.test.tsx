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
// Real OperationalBrief and canonical conversions render. Converter spies
// record untouched SI inputs; source contexts and battery colour survive.
// Prop-driven source data never touches the network.

import type { ReactNode } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'

const { mockT, formatDistance, formatSpeed, formatTemperature } = vi.hoisted(() => ({
  mockT: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
  formatDistance: vi.fn(),
  formatSpeed: vi.fn(),
  formatTemperature: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}))

// Observe the raw inputs to the real canonical display converters, not an echo UI.
vi.mock('@/lib/unitConversion', async importActual => {
  const actual = await importActual<typeof import('@/lib/unitConversion')>()
  return { ...actual,
    convertDistanceFromSI: (...args: Parameters<typeof actual.convertDistanceFromSI>) => {
      formatDistance(args[0]); return actual.convertDistanceFromSI(...args)
    },
    convertSpeedFromSI: (...args: Parameters<typeof actual.convertSpeedFromSI>) => {
      formatSpeed(args[0]); return actual.convertSpeedFromSI(...args)
    },
    convertTempFromSI: (...args: Parameters<typeof actual.convertTempFromSI>) => {
      formatTemperature(args[0]); return actual.convertTempFromSI(...args)
    },
  }
})

import { QuickStatsGrid, batteryColor, formatBatteryLevel } from './QuickStatsGrid'
import type { VehicleState, VehicleStatus } from '@/api/types'
import { statText } from '../statstrip-vehicle-detail/testQueries'

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

function metricCard(label: string): HTMLElement {
  const card = screen
    .getByText(label)
    .closest<HTMLElement>('[data-operational-metric]')
  expect(card).not.toBeNull()
  return card as HTMLElement
}

function metricColor(label: string): string | null {
  return metricCard(label)
    .querySelector('[data-battery-color]')
    ?.getAttribute('data-battery-color') ?? null
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
    expect(formatBatteryLevel(72)).toBe('72.00%')
    expect(formatBatteryLevel(0)).toBe('0.00%')
  })

  it('renders an em-dash for missing / non-finite levels (never "null%")', () => {
    expect(formatBatteryLevel(null)).toBe('—')
    expect(formatBatteryLevel(undefined)).toBe('—')
    expect(formatBatteryLevel(NaN)).toBe('—')
  })
})

describe('QuickStatsGrid', () => {
  it('updates the same eight tiles through charge boundaries without rerouting any formatter', () => {
    const original = { ...fullState }
    const { rerender } = render(<QuickStatsGrid state={original} status="driving" />)
    expect(document.querySelector('[data-testid="vehicle-quick-stats-summary"][data-operational-brief]')).not.toBeNull()
    const cards = Array.from(document.querySelectorAll('[data-operational-metric]'))
    const value = (label: string, text: string) =>
      expect(within(metricCard(label)).getByText(statText(text))).toBeInTheDocument()

    for (const [level, color] of [[50, 'cyan'], [20, 'red'], [0, 'red'], [51, 'green']] as const) {
      const next = {
        ...original,
        battery_level: level,
        rated_range: 123456,
        odometer: 789012,
        speed: 0,
        inside_temp: 0,
        outside_temp: -7,
        power: 0,
      }
      formatDistance.mockClear()
      formatSpeed.mockClear()
      formatTemperature.mockClear()
      rerender(<QuickStatsGrid state={next} status="charging" />)
      const updatedCards = Array.from(document.querySelectorAll('[data-operational-metric]'))
      expect(updatedCards).toHaveLength(8)
      updatedCards.forEach((card, index) => expect(card).toBe(cards[index]))
      expect(metricColor('Battery')).toBe(color)
      value('Battery', `${level.toFixed(2)}%`)
      value('Range', '123.46 km')
      value('Odometer', '789.01 km')
      value('Speed', '0.00 km/h')
      value('Inside temp', '0.00°C')
      value('Outside temp', '-7.00°C')
      value('Power', '0.00 kW')
      value('State', 'charging')
      expect(formatDistance.mock.calls).toEqual([[123456], [789012]])
      expect(formatSpeed.mock.calls).toEqual([[0]])
      expect(formatTemperature.mock.calls).toEqual([[0], [-7]])
    }
    expect(original).toEqual(fullState)
  })

  it('renders all eight KPI tiles with their labels and formatted values', () => {
    renderGrid()

    for (const label of [
      'Battery',
      'Range',
      'Odometer',
      'Speed',
      'Inside temp',
      'Outside temp',
      'Power',
      'State',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }

    // Shared numeric formatting preserves the measured percentage.
    expect(screen.getByText(statText('72.00%'))).toBeInTheDocument()
    // Power formatted with the kW suffix at global precision (2).
    expect(screen.getByText(statText('0.05 kW'))).toBeInTheDocument()
    // Status echoed into the State tile.
    expect(screen.getByText('driving')).toBeInTheDocument()
  })

  it('routes distance + speed + temperature through canonical conversions with untouched SI values and saved precision', () => {
    renderGrid()

    // rated_range and odometer both go through the distance formatter.
    expect(formatDistance).toHaveBeenCalledWith(320000)
    expect(formatDistance).toHaveBeenCalledWith(15000000)
    expect(formatSpeed).toHaveBeenCalledWith(25)
    expect(formatTemperature).toHaveBeenCalledWith(21)
    expect(formatTemperature).toHaveBeenCalledWith(8)

    // The real converted output, not fixture text, renders.
    expect(screen.getByText(statText('320.00 km'))).toBeInTheDocument()
    expect(screen.getByText(statText('15,000.00 km'))).toBeInTheDocument()
    expect(screen.getByText(statText('90.00 km/h'))).toBeInTheDocument()
    expect(screen.getByText(statText('21.00°C'))).toBeInTheDocument()
    expect(screen.getByText(statText('8.00°C'))).toBeInTheDocument()
  })

  it('renders a 0 °C temperature verbatim — the formatter guard must not swallow the falsy 0', () => {
    renderGrid({ inside_temp: 0 })
    expect(formatTemperature).toHaveBeenCalledWith(0)
    expect(screen.getByText(statText('0.00°C'))).toBeInTheDocument()
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
    renderGrid({ battery_level: 12 })
    expect(metricColor('Battery')).toBe('red')
    expect(screen.getByText(statText('12.00%'))).toBeInTheDocument()

    cleanup()

    renderGrid({ battery_level: 88 })
    expect(metricColor('Battery')).toBe('green')
  })

  it('degrades missing numeric readings to an em-dash instead of "null%" / "0.00 kW" / a blank tile', () => {
    expect(() =>
      renderGrid({ battery_level: null, power: null }),
    ).not.toThrow()

    // Battery + power both collapse to the em-dash placeholder…
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    // …never the literal broken strings.
    expect(screen.queryByText('null%')).toBeNull()
    expect(screen.queryByText(statText('0.00 kW'))).toBeNull()
    // The battery tile with an unknown level uses the neutral cyan accent.
    expect(metricColor('Battery')).toBe('cyan')
  })

  it('renders a 0% battery verbatim with the red critical accent (not an em-dash)', () => {
    renderGrid({ battery_level: 0 })
    expect(screen.getByText(statText('0.00%'))).toBeInTheDocument()
    expect(metricColor('Battery')).toBe('red')
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
      ['common.insideTemp', 'Inside temp'],
      ['common.outsideTemp', 'Outside temp'],
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
