/**
 * ChargingTelemetrySection unit tests.
 *
 * The section renders a live charging-telemetry snapshot as a grid of
 * MetricCards. Every numeric input arrives from the API in SI-canonical units
 * (watts, watt-hours, meters, meters/hour, volts, amperes) and must be
 * converted at the render boundary through `useUnits()` before display.
 *
 * The global test setup (`src/test-setup.ts`) mocks `@/hooks/useSettings` with
 * the SI defaults (km / °C / bar, kWh, kW, en-US, precision 2), so the REAL
 * `useUnits` + `lib/unitConversion` run here and exercise the actual conversion
 * math. That is deliberate: these tests are the regression guard for the 1000×
 * unit bug where `charger_power_w` (watts) was rendered with a raw "kW" suffix
 * and `charge_energy_added_wh` (watt-hours) with a raw "kWh" suffix — neither
 * dividing by 1000 — which this file's fix corrects by delegating to
 * `formatPower` / `formatEnergy` (matching the sibling EnergyChargingPanel).
 *
 * Coverage:
 *   1. SI power/energy convert to kW/kWh (regression guard, no raw watts/Wh).
 *   2. Voltage, current, battery level render with their SI unit suffix.
 *   3. Charge rate converts m/h→m/s→km/h; range added converts m→km.
 *   4. Charging state string passes through; heading is a real heading element.
 *   5. Null metric fields degrade to em-dash without crashing or fabricating units.
 *   6. Null telemetry shows the empty state (role=status) and hides the grid.
 *   7. Undefined telemetry shows the empty state and hides the metrics.
 *   8. a11y: every decorative icon is aria-hidden.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ChargingTelemetry } from '@/api/types'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import { ChargingTelemetrySection } from './ChargingTelemetrySection'

function makeTelemetry(overrides: Partial<ChargingTelemetry> = {}): ChargingTelemetry {
  return {
    vehicle_id: 1,
    ts: '2026-01-01T00:00:00Z',
    session_id: 10,
    battery_level: 82,
    battery_range_mi: 210,
    charging_state: 'Charging',
    charger_voltage: 240,
    charger_actual_current: 32,
    // 11 kW charger expressed in SI watts.
    charger_power_w: 11000,
    charger_phases: 1,
    // 42.5 kWh added expressed in SI watt-hours.
    charge_energy_added_wh: 42500,
    // 120 km of range added expressed in SI meters.
    range_added_meters: 120000,
    // 36 km/h of range added, expressed in SI meters/hour (10 m/s).
    range_added_meters_per_hour: 36000,
    charger_pilot_current: 32,
    scheduled_charging_at: null,
    source: 'test',
    ...overrides,
  }
}

describe('ChargingTelemetrySection — SI unit conversion (1000× regression guard)', () => {
  it('converts SI watts to kW and watt-hours to kWh at the display boundary', () => {
    render(<ChargingTelemetrySection chargingTelemetry={makeTelemetry()} />)

    expect(screen.getByText('11.00 kW')).toBeInTheDocument()
    expect(screen.getByText('42.50 kWh')).toBeInTheDocument()
  })

  it('does not render the raw SI magnitude with a display-unit suffix', () => {
    render(<ChargingTelemetrySection chargingTelemetry={makeTelemetry()} />)

    // Pre-fix, `${fmtNumber(11000)} kW` printed "11,000.00 kW" and
    // `${fmtNumber(42500)} kWh` printed "42,500.00 kWh".
    expect(screen.queryByText('11,000.00 kW')).toBeNull()
    expect(screen.queryByText('42,500.00 kWh')).toBeNull()
  })
})

describe('ChargingTelemetrySection — metric rendering', () => {
  it('renders voltage, current, and battery level with their SI unit suffixes', () => {
    render(<ChargingTelemetrySection chargingTelemetry={makeTelemetry()} />)

    expect(screen.getByText('Voltage')).toBeInTheDocument()
    expect(screen.getByText('240.00 V')).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.getByText('32.00 A')).toBeInTheDocument()
    expect(screen.getByText('Battery Level')).toBeInTheDocument()
    expect(screen.getByText('82.00%')).toBeInTheDocument()
  })

  it('converts charge rate (m/h→m/s→km/h) and range added (m→km)', () => {
    render(<ChargingTelemetrySection chargingTelemetry={makeTelemetry()} />)

    // 36000 m/h ÷ 3600 = 10 m/s → 36.00 km/h.
    expect(screen.getByText('36.00 km/h')).toBeInTheDocument()
    // 120000 m → 120.00 km.
    expect(screen.getByText('120.00 km')).toBeInTheDocument()
  })

  it('passes the charging_state string through verbatim and renders a real heading', () => {
    const { rerender } = render(
      <ChargingTelemetrySection chargingTelemetry={makeTelemetry({ charging_state: 'Charging' })} />,
    )
    expect(screen.getByText('Charging')).toBeInTheDocument()

    rerender(
      <ChargingTelemetrySection chargingTelemetry={makeTelemetry({ charging_state: 'Complete' })} />,
    )
    expect(screen.getByText('Complete')).toBeInTheDocument()

    const heading = screen.getByRole('heading', { name: /Charging Telemetry/i })
    expect(heading).toBeInTheDocument()
  })
})

describe('ChargingTelemetrySection — null safety', () => {
  it('renders em-dash placeholders for null fields without fabricating unit strings', () => {
    render(
      <ChargingTelemetrySection
        chargingTelemetry={makeTelemetry({
          charger_power_w: null,
          charger_voltage: null,
          charger_actual_current: null,
          charge_energy_added_wh: null,
          charging_state: null,
          battery_level: null,
          range_added_meters_per_hour: null,
          range_added_meters: null,
        })}
      />,
    )

    // All eight metrics collapse to '—'.
    expect(screen.getAllByText('—')).toHaveLength(8)
    // No fabricated unit strings when the underlying value is missing.
    expect(screen.queryByText(/kW\b/)).toBeNull()
    expect(screen.queryByText(/kWh\b/)).toBeNull()
    expect(screen.queryByText(/km\/h/)).toBeNull()
    // The labels still render so the panel never shows a blank grid.
    expect(screen.getByText('Charger Power')).toBeInTheDocument()
  })
})

describe('ChargingTelemetrySection — empty states', () => {
  it('renders the empty state and hides the metric grid when telemetry is null', () => {
    render(<ChargingTelemetrySection chargingTelemetry={null} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No charging telemetry available')).toBeInTheDocument()
    expect(screen.queryByText('Charger Power')).toBeNull()
    expect(screen.queryByText('Battery Level')).toBeNull()
  })

  it('renders the empty state when telemetry is undefined', () => {
    render(<ChargingTelemetrySection chargingTelemetry={undefined} />)

    expect(screen.getByText('No charging telemetry available')).toBeInTheDocument()
    expect(screen.queryByText('Voltage')).toBeNull()
  })
})

describe('ChargingTelemetrySection — accessibility', () => {
  it('marks every decorative icon as aria-hidden', () => {
    const { container } = render(
      <ChargingTelemetrySection chargingTelemetry={makeTelemetry()} />,
    )

    // The heading icon plus all eight metric icons are purely decorative;
    // the adjacent label text carries the meaning, so no SVG should be
    // exposed to the accessibility tree.
    expect(container.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0)
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(9)
  })
})
