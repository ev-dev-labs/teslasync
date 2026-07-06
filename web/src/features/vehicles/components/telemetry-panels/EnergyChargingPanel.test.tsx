/**
 * EnergyChargingPanel unit tests.
 *
 * The panel renders a live charging-telemetry snapshot. All numeric inputs
 * arrive from the API in SI-canonical units (watts, watt-hours, meters/hour,
 * volts, amperes) and must be converted at the render boundary through
 * `useUnits()` before display.
 *
 * The global test setup (`src/test-setup.ts`) mocks `@/hooks/useSettings`
 * with the SI defaults (km / °C / bar, kWh, kW, en-US, precision 2), so the
 * REAL `useUnits` + `lib/unitConversion` run here and exercise the actual
 * conversion math. That is deliberate: it lets these tests act as a
 * regression guard for the 1000× unit bug where `charger_power_w` (watts)
 * was rendered with a raw "kW" suffix and `charge_energy_added_wh`
 * (watt-hours) with a raw "kWh" suffix — neither dividing by 1000.
 *
 * Coverage:
 *   1. SI power/energy convert to kW/kWh (regression guard, no raw watts).
 *   2. Voltage, current, battery level, and charge-rate render.
 *   3. Charging-state badge picks semantic colors per state.
 *   4. Null metric fields degrade to em-dash + "Unknown" without crashing.
 *   5. Null telemetry shows the empty state (role=status).
 *   6. Undefined telemetry shows the empty state and hides the metrics.
 *   7. The localized panel heading renders as a real heading.
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

import { EnergyChargingPanel } from './EnergyChargingPanel'

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
    range_added_meters: 120000,
    // 36 km/h of range added, expressed in SI meters/hour (10 m/s).
    range_added_meters_per_hour: 36000,
    charger_pilot_current: 32,
    scheduled_charging_at: null,
    source: 'test',
    ...overrides,
  }
}

describe('EnergyChargingPanel — SI unit conversion', () => {
  it('converts SI watts to kW and watt-hours to kWh at the display boundary', () => {
    render(<EnergyChargingPanel chargingTelemetry={makeTelemetry()} />)

    expect(screen.getByText('11.00 kW')).toBeInTheDocument()
    expect(screen.getByText('42.50 kWh')).toBeInTheDocument()
  })

  it('does not render the raw SI magnitude with a display-unit suffix (1000× regression guard)', () => {
    render(<EnergyChargingPanel chargingTelemetry={makeTelemetry()} />)

    // Pre-fix, fmtWithUnit(11000, 'kW') printed "11,000.00 kW" and
    // fmtWithUnit(42500, 'kWh') printed "42,500.00 kWh".
    expect(screen.queryByText('11,000.00 kW')).toBeNull()
    expect(screen.queryByText('42,500.00 kWh')).toBeNull()
    expect(screen.getByText('11.00 kW')).toBeInTheDocument()
  })

  it('renders voltage, current, battery level, and converts charge rate to km/h', () => {
    render(<EnergyChargingPanel chargingTelemetry={makeTelemetry()} />)

    expect(screen.getByText('Charger Voltage')).toBeInTheDocument()
    expect(screen.getByText('240.00')).toBeInTheDocument()
    expect(screen.getByText('Charger Current')).toBeInTheDocument()
    expect(screen.getByText('32.00')).toBeInTheDocument()
    expect(screen.getByText('82.00%')).toBeInTheDocument()
    // 36000 m/h ÷ 3600 = 10 m/s → 36.00 km/h.
    expect(screen.getByText('36.00 km/h')).toBeInTheDocument()
  })
})

describe('EnergyChargingPanel — charging-state badge', () => {
  it('applies semantic colors for Charging, Complete, and other states', () => {
    const { rerender } = render(
      <EnergyChargingPanel chargingTelemetry={makeTelemetry({ charging_state: 'Charging' })} />,
    )
    const charging = screen.getByText('Charging')
    expect(charging).toHaveClass('text-cyan-400')
    expect(charging).toHaveClass('bg-cyan-500/10')

    rerender(
      <EnergyChargingPanel chargingTelemetry={makeTelemetry({ charging_state: 'Complete' })} />,
    )
    expect(screen.getByText('Complete')).toHaveClass('text-green-400')

    rerender(
      <EnergyChargingPanel chargingTelemetry={makeTelemetry({ charging_state: 'Stopped' })} />,
    )
    expect(screen.getByText('Stopped')).toHaveClass('bg-gray-500/10')
  })
})

describe('EnergyChargingPanel — null safety', () => {
  it('renders em-dash placeholders and an Unknown state for null fields', () => {
    render(
      <EnergyChargingPanel
        chargingTelemetry={makeTelemetry({
          charger_voltage: null,
          charger_actual_current: null,
          charger_power_w: null,
          charge_energy_added_wh: null,
          battery_level: null,
          range_added_meters_per_hour: null,
          charging_state: null,
        })}
      />,
    )

    expect(screen.getByText('Unknown')).toBeInTheDocument()
    // voltage, current, power, energy, battery, charge-rate all collapse to '—'.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    // No fabricated unit strings when the underlying value is missing.
    expect(screen.queryByText(/kW/)).toBeNull()
    expect(screen.queryByText(/km\/h/)).toBeNull()
  })
})

describe('EnergyChargingPanel — empty states', () => {
  it('renders the empty state when telemetry is null', () => {
    render(<EnergyChargingPanel chargingTelemetry={null} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No charging telemetry available')).toBeInTheDocument()
  })

  it('renders the empty state and hides metric rows when telemetry is undefined', () => {
    render(<EnergyChargingPanel chargingTelemetry={undefined} />)

    expect(screen.getByText('No charging telemetry available')).toBeInTheDocument()
    expect(screen.queryByText('Charger Power')).toBeNull()
    expect(screen.queryByText('Battery Level')).toBeNull()
  })
})

describe('EnergyChargingPanel — heading', () => {
  it('renders the localized panel heading as a real heading element', () => {
    render(<EnergyChargingPanel chargingTelemetry={makeTelemetry()} />)

    const heading = screen.getByRole('heading', { name: /Energy & Charging/i })
    expect(heading).toBeInTheDocument()
    expect(screen.getByText('Charger Power')).toBeInTheDocument()
  })
})
