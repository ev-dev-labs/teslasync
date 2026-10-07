// Behavioural coverage for TelemetryGrid — the six-tile live telemetry strip
// (battery / speed / inside-temp / odometer / charger / sentry) rendered on the
// vehicle detail view. The grid is a pure prop-driven presenter over a
// VehicleState, so the contract worth pinning is the per-tile branching:
//   - battery colour thresholds (>50 emerald / >20 amber / else rose) including
//     the null-safe `?? 0` guard so an absent level neither throws nor mis-colours,
//   - speed → Driving / Parked (null-safe),
//   - charger value (kW while charging, i18n "Not Charging" otherwise), the
//     emerald/muted colour, and the "Full in Xh" ETA sub-line which must be HIDDEN
//     when time_to_full_charge is 0 / null (the regression this file pins — the old
//     `!= null` guard leaked a nonsensical "Full in 0.00h"),
//   - sentry Active / Off,
//   - inside/outside temperature composition + which VehicleState field is routed
//     to which useUnits formatter (with the odometer precision:0 override), and
//   - that every visible label + status string is resolved through i18n (no raw
//     English literals).
//
// react-i18next is mocked so `t(key, fallback)` returns the English fallback AND
// records the exact key/fallback each string wires to (mirrors the sibling
// InfoTile test). useUnits is mocked with echo formatters so we can assert the
// precise value routed to each formatter deterministically, with no unit maths in
// the test. The motion wrappers collapse to plain divs. The real InfoTile +
// GlassPanel render, proving the tiles mount inside the shared panel shell.
// Nothing here touches the network — TelemetryGrid receives its data as a prop.

import type { ComponentProps, ReactNode } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { mockT, formatDistance, formatSpeed, formatTemperature } = vi.hoisted(() => ({
  mockT: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
  formatDistance: vi.fn(
    (v: number | null | undefined, _options?: { precision?: number }) => `${v ?? 'nil'} km`,
  ),
  formatSpeed: vi.fn((v: number | null | undefined) => `${v ?? 'nil'} km/h`),
  formatTemperature: vi.fn((v: number | null | undefined) => `${v ?? 'nil'}°C`),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDistance, formatSpeed, formatTemperature }),
}))

// Collapse the entrance-animation wrappers to inert pass-through divs so the test
// exercises TelemetryGrid's branching, not framer-motion.
vi.mock('@/components/motion', () => ({
  StaggerContainer: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  StaggerItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

import { TelemetryGrid } from './TelemetryGrid'
import type { VehicleState } from '@/api/types'

type Props = ComponentProps<typeof TelemetryGrid>

// A fully-populated, "happy path" state: online, driving at 45, 82% battery,
// charging with 1.5h to full, sentry armed.
const baseState: VehicleState = {
  vehicle_id: 1,
  state: 'online',
  latitude: 37.5,
  longitude: -122.3,
  speed: 45,
  power: 12,
  battery_level: 82,
  rated_range: 312,
  ideal_range: 350,
  odometer: 45000,
  inside_temp: 21,
  outside_temp: 15,
  is_climate_on: true,
  is_charging: true,
  charger_power: 11,
  charge_rate: 30,
  time_to_full_charge: 1.5,
  is_locked: true,
  sentry_mode: true,
  software_version: '2024.44.25',
}

function renderGrid(overrides: Partial<VehicleState> = {}) {
  const props: Props = { state: { ...baseState, ...overrides } }
  return render(<TelemetryGrid {...props} />)
}

beforeEach(() => {
  mockT.mockClear()
  formatDistance.mockClear()
  formatSpeed.mockClear()
  formatTemperature.mockClear()
})
afterEach(cleanup)

describe('TelemetryGrid', () => {
  it('renders all six telemetry tiles inside the shared panel shell', () => {
    const { container } = renderGrid()

    for (const label of ['Battery', 'Speed', 'Inside', 'Odometer', 'Charger', 'Sentry']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // One GlassPanel (data-print-card) per tile — always six, never a hidden section.
    expect(container.querySelectorAll('[data-print-card]')).toHaveLength(6)
  })

  it('formats the battery percent + range sub-line and routes rated_range through formatDistance', () => {
    renderGrid({ battery_level: 82, rated_range: 312 })

    expect(screen.getByText('82%')).toBeInTheDocument()
    // rated_range → formatDistance with no precision override; the "range" word is i18n.
    expect(formatDistance).toHaveBeenCalledWith(312)
    expect(screen.getByText('312 km range')).toBeInTheDocument()
    expect(mockT).toHaveBeenCalledWith('common.range', 'range')
  })

  it('colours the battery value by charge threshold (>50 emerald, >20 amber, else rose)', () => {
    renderGrid({ battery_level: 82 })
    expect(screen.getByText('82%').className).toContain('text-emerald-300')
    cleanup()

    renderGrid({ battery_level: 35 })
    expect(screen.getByText('35%').className).toContain('text-amber-300')
    cleanup()

    renderGrid({ battery_level: 8 })
    expect(screen.getByText('8%').className).toContain('text-rose-300')
  })

  it('treats the colour thresholds as exclusive (exactly 50 → amber, exactly 20 → rose)', () => {
    renderGrid({ battery_level: 50 })
    expect(screen.getByText('50%').className).toContain('text-amber-300')
    cleanup()

    renderGrid({ battery_level: 20 })
    expect(screen.getByText('20%').className).toContain('text-rose-300')
  })

  it('is null-safe for an absent battery level (renders 0% at the critical colour, no throw)', () => {
    expect(() => renderGrid({ battery_level: undefined as unknown as number })).not.toThrow()

    const value = screen.getByText('0%')
    expect(value).toBeInTheDocument()
    // `(state.battery_level ?? 0) > 50` — undefined collapses to 0 → rose, never a
    // NaN-comparison-driven blank or an "undefined%" leak.
    expect(value.className).toContain('text-rose-300')
    expect(screen.queryByText('undefined%')).toBeNull()
  })

  it('labels speed as Driving when moving and Parked when stopped, via i18n', () => {
    renderGrid({ speed: 45 })
    expect(screen.getByText('45 km/h')).toBeInTheDocument()
    expect(screen.getByText('Driving')).toBeInTheDocument()
    expect(mockT).toHaveBeenCalledWith('common.driving', 'Driving')

    cleanup()
    mockT.mockClear()

    renderGrid({ speed: 0 })
    expect(screen.getByText('Parked')).toBeInTheDocument()
    expect(mockT).toHaveBeenCalledWith('common.parked', 'Parked')
    expect(screen.queryByText('Driving')).toBeNull()
  })

  it('falls back to Parked when speed is missing (null-safe comparison)', () => {
    renderGrid({ speed: undefined as unknown as number })
    expect(screen.getByText('Parked')).toBeInTheDocument()
    expect(screen.queryByText('Driving')).toBeNull()
  })

  it('shows charger power + a "Full in" ETA while charging with time remaining', () => {
    renderGrid({ is_charging: true, charger_power: 11, time_to_full_charge: 1.5 })

    const value = screen.getByText('11 kW')
    expect(value.className).toContain('text-emerald-300')
    // fmtNumber(1.5, 1) → "1.5"; the "Full in" prefix is i18n.
    expect(screen.getByText('Full in {{hours}}h')).toBeInTheDocument()
    expect(mockT).toHaveBeenCalledWith('telemetry.fullInHours', 'Full in {{hours}}h', { hours: '1.5' })
  })

  it('hides the "Full in" ETA when time_to_full_charge is 0 or null (regression: no "Full in 0h")', () => {
    renderGrid({ is_charging: true, charger_power: 7, time_to_full_charge: 0 })
    expect(screen.getByText('7 kW')).toBeInTheDocument()
    expect(screen.queryByText(/Full in/)).toBeNull()

    cleanup()

    renderGrid({
      is_charging: true,
      charger_power: 7,
      time_to_full_charge: null as unknown as number,
    })
    expect(screen.queryByText(/Full in/)).toBeNull()
  })

  it('shows an i18n "Not Charging" label with muted colour and no ETA when idle', () => {
    renderGrid({ is_charging: false })

    const value = screen.getByText('Not Charging')
    expect(value.className).toContain('text-[var(--text-muted)]')
    expect(screen.queryByText(/Full in/)).toBeNull()
    expect(mockT).toHaveBeenCalledWith('common.notCharging', 'Not Charging')
  })

  it('renders sentry state as Active (rose) or Off (muted) through i18n', () => {
    renderGrid({ sentry_mode: true })
    const active = screen.getByText('Active')
    expect(active.className).toContain('text-rose-300')
    expect(mockT).toHaveBeenCalledWith('common.active', 'Active')

    cleanup()
    mockT.mockClear()

    renderGrid({ sentry_mode: false })
    const off = screen.getByText('Off')
    expect(off.className).toContain('text-[var(--text-muted)]')
    expect(mockT).toHaveBeenCalledWith('common.off', 'Off')
  })

  it('composes inside/outside temperature and routes each field to formatTemperature', () => {
    renderGrid({ inside_temp: 21, outside_temp: 15 })

    expect(screen.getByText('21°C')).toBeInTheDocument()
    expect(screen.getByText('Outside: 15°C')).toBeInTheDocument()
    expect(formatTemperature).toHaveBeenCalledWith(21)
    expect(formatTemperature).toHaveBeenCalledWith(15)
  })

  it('passes the precision:0 override when formatting the odometer', () => {
    renderGrid({ odometer: 45000 })

    expect(screen.getByText('45000 km')).toBeInTheDocument()
    expect(formatDistance).toHaveBeenCalledWith(45000, { precision: 0 })
  })

  it('wires every tile label to its i18n key (no raw English labels)', () => {
    renderGrid()

    const expected: ReadonlyArray<readonly [string, string]> = [
      ['common.battery', 'Battery'],
      ['common.speed', 'Speed'],
      ['common.inside', 'Inside'],
      ['common.outside', 'Outside'],
      ['common.odometer', 'Odometer'],
      ['common.charger', 'Charger'],
      ['common.sentry', 'Sentry'],
    ]
    for (const [key, fallback] of expected) {
      expect(mockT).toHaveBeenCalledWith(key, fallback)
    }
  })
})
