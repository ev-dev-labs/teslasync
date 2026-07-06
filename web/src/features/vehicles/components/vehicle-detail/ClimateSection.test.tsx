// Behavioural coverage for ClimateSection — the climate/HVAC panel on the
// vehicle detail view. It is a pure prop-driven presenter over a
// ClimateSnapshot, so the contract worth pinning is:
//   - the null/undefined snapshot → shared EmptyState (role=status) with an i18n
//     message, while the panel title still renders (never a blank section),
//   - the three temperature cards routing the *legacy-alias-preferred* SI value
//     (`inside_temp ?? inside_temp_c` etc.) through the useUnits formatter,
//     including the falsy 0°C that a `||` bug would swallow,
//   - fan speed preferring hvac_fan_status → fan_status → em-dash, with a falsy 0
//     rendered verbatim (the `!= null` guard, not a truthiness check),
//   - seat-heater "Level N" incl. Level 0, em-dash when null,
//   - defrost showing the mode string only when set AND not "Off" (else i18n Off),
//   - the "Climate On" nullish-coalescing (`is_ac_on ?? is_climate_on`) where an
//     explicit `false` AC state must win over a truthy climate flag,
//   - every visible label resolved through i18n (no raw English literals), and
//   - a11y: every decorative glyph (panel + each card) is aria-hidden.
//
// react-i18next is mocked so `t(key, fallback)` returns the English fallback AND
// records the exact key/fallback each string wires to (mirrors the sibling
// TelemetryGrid / InfoTile tests). useUnits is mocked with an echo temperature
// formatter so we can assert the precise Celsius value routed to it and its
// null→placeholder behaviour, with no unit maths in the test. The real
// GlassPanel + PanelTitle + MetricCard + EmptyState render, proving the cards
// mount inside the shared panel shell. Nothing here touches the network —
// ClimateSection receives its data as a prop.

import type { ComponentProps, ReactNode } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { mockT, formatTemperature } = vi.hoisted(() => ({
  mockT: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
  // Mirrors the real lib formatter: nullish/NaN → em-dash placeholder, else a
  // "<value>°C" echo so the exact Celsius value routed to each card is provable.
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
  useUnits: () => ({ formatTemperature }),
}))

import { ClimateSection } from './ClimateSection'
import type { ClimateSnapshot } from '@/api/types'

type Props = ComponentProps<typeof ClimateSection>

// A fully-populated snapshot using only the canonical SI columns (the legacy
// aliases stay undefined, so `alias ?? canonical` resolves to the canonical
// value — the shape a live typed-column response actually has).
const fullClimate: ClimateSnapshot = {
  vehicle_id: 1,
  ts: '2025-01-01T00:00:00Z',
  inside_temp_c: 21,
  outside_temp_c: 15,
  driver_setpoint_c: 22,
  passenger_setpoint_c: 22,
  hvac_state: 'On',
  defrost_mode: 'Off',
  is_climate_on: true,
  is_preconditioning: false,
  fan_status: 3,
  seat_heater_left: 2,
  seat_heater_right: 1,
  seat_heater_rear_left: null,
  seat_heater_rear_right: null,
  steering_wheel_heater: null,
  cabin_overheat_protection: null,
  source: 'test',
}

function renderSection(overrides: Partial<ClimateSnapshot> = {}) {
  const props: Props = { climateData: { ...fullClimate, ...overrides } }
  return render(<ClimateSection {...props} />)
}

const dashes = () => screen.getAllByText('—')

beforeEach(() => {
  mockT.mockClear()
  formatTemperature.mockClear()
})
afterEach(cleanup)

describe('ClimateSection', () => {
  it('renders the panel title + all eight metric cards inside the shared glass panel', () => {
    const { container } = renderSection()

    // Panel heading is always present (h3 via PanelTitle) — the section is never
    // hidden, even when the body is empty.
    expect(screen.getByRole('heading', { level: 3, name: 'Climate' })).toBeInTheDocument()

    for (const label of [
      'Inside Temp',
      'Outside Temp',
      'Driver Setpoint',
      'Fan Speed',
      'Seat Heater Left',
      'Seat Heater Right',
      'Defrost',
      'Climate On',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }

    // Mounted inside the shared GlassPanel shell (data-print-card marker).
    expect(container.querySelector('[data-print-card]')).not.toBeNull()
    // No EmptyState placeholder when data is present.
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the shared EmptyState (not a blank panel) when the snapshot is null', () => {
    render(<ClimateSection climateData={null} />)

    // Title still renders; the body degrades to the i18n empty message.
    expect(screen.getByRole('heading', { level: 3, name: 'Climate' })).toBeInTheDocument()
    const empty = screen.getByRole('status')
    expect(empty).toHaveTextContent('No climate data available')
    expect(mockT).toHaveBeenCalledWith('vehicles.detail.noClimateData', 'No climate data available')

    // None of the metric cards leak through in the empty branch.
    expect(screen.queryByText('Inside Temp')).toBeNull()
    expect(formatTemperature).not.toHaveBeenCalled()
  })

  it('treats undefined the same as null (empty state, no throw)', () => {
    expect(() => render(<ClimateSection climateData={undefined} />)).not.toThrow()
    expect(screen.getByRole('status')).toHaveTextContent('No climate data available')
    expect(screen.queryByText('Fan Speed')).toBeNull()
  })

  it('routes each temperature field through the useUnits formatter and renders the echo', () => {
    renderSection({ inside_temp_c: 21, outside_temp_c: 15, driver_setpoint_c: 22 })

    expect(formatTemperature).toHaveBeenCalledWith(21)
    expect(formatTemperature).toHaveBeenCalledWith(15)
    expect(formatTemperature).toHaveBeenCalledWith(22)
    expect(screen.getByText('21°C')).toBeInTheDocument()
    expect(screen.getByText('15°C')).toBeInTheDocument()
    expect(screen.getByText('22°C')).toBeInTheDocument()
  })

  it('prefers the legacy temperature alias over the canonical column when present', () => {
    // inside_temp (legacy) must win over inside_temp_c (canonical) — `?? ` order.
    renderSection({ inside_temp: 18, inside_temp_c: 99 })

    expect(formatTemperature).toHaveBeenCalledWith(18)
    expect(screen.getByText('18°C')).toBeInTheDocument()
    expect(screen.queryByText('99°C')).toBeNull()
  })

  it('renders a 0°C temperature verbatim — the ?? guard must not swallow the falsy 0', () => {
    // A `alias || canonical` bug would fall through 0 to the 99 canonical value.
    renderSection({ inside_temp: 0, inside_temp_c: 99 })

    expect(formatTemperature).toHaveBeenCalledWith(0)
    expect(screen.getByText('0°C')).toBeInTheDocument()
    expect(screen.queryByText('99°C')).toBeNull()
  })

  it('shows an em-dash for a missing temperature instead of "undefined" or a blank cell', () => {
    renderSection({
      inside_temp: null,
      inside_temp_c: null,
      // Keep the other numeric cards populated so the only dashes come from temp.
      outside_temp_c: 15,
      driver_setpoint_c: 22,
    })

    expect(formatTemperature).toHaveBeenCalledWith(null)
    // The nullish inside temp collapses to the em-dash placeholder…
    expect(dashes().length).toBeGreaterThanOrEqual(1)
    // …never the literal "undefined°C", and the populated cards are unaffected.
    expect(screen.queryByText('undefined°C')).toBeNull()
    expect(screen.getByText('15°C')).toBeInTheDocument()
  })

  it('prefers hvac_fan_status, falls back to fan_status, then an em-dash', () => {
    renderSection({ hvac_fan_status: 4, fan_status: 3 })
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.queryByText('3')).toBeNull()

    cleanup()

    renderSection({ hvac_fan_status: null, fan_status: 3 })
    expect(screen.getByText('3')).toBeInTheDocument()

    cleanup()

    renderSection({ hvac_fan_status: null, fan_status: null })
    // Fan card falls to the em-dash placeholder.
    expect(dashes().length).toBeGreaterThanOrEqual(1)
  })

  it('renders fan speed 0 verbatim (regression: != null guard, not a truthiness check)', () => {
    renderSection({ hvac_fan_status: 0, fan_status: 9 })
    // 0 is a valid fan status; a `hvac_fan_status || fan_status` bug would show 9.
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.queryByText('9')).toBeNull()
  })

  it('renders seat-heater levels including Level 0, and an em-dash when unset', () => {
    renderSection({ seat_heater_left: 3, seat_heater_right: 0 })

    expect(screen.getByText('Level 3')).toBeInTheDocument()
    // The falsy 0 must still render as "Level 0", not an em-dash.
    expect(screen.getByText('Level 0')).toBeInTheDocument()
    expect(mockT).toHaveBeenCalledWith('common.level', 'Level')

    cleanup()
    mockT.mockClear()

    renderSection({ seat_heater_left: null, seat_heater_right: null })
    // Both seat cards fall to em-dash.
    expect(dashes().length).toBeGreaterThanOrEqual(2)
  })

  it('shows the defrost mode when active and the i18n "Off" label otherwise', () => {
    renderSection({ defrost_mode: 'Front' })
    expect(screen.getByText('Front')).toBeInTheDocument()

    cleanup()
    mockT.mockClear()

    // Literal "Off" mode → collapses to the translated Off label.
    renderSection({ defrost_mode: 'Off' })
    expect(mockT).toHaveBeenCalledWith('common.off', 'Off')
    expect(screen.queryByText('Front')).toBeNull()

    cleanup()

    // Null mode → also the Off label, no crash.
    expect(() => renderSection({ defrost_mode: null })).not.toThrow()
    expect(screen.getByText('Defrost')).toBeInTheDocument()
  })

  it('drives "Climate On" from is_ac_on, falling back to is_climate_on only when AC is nullish', () => {
    // Explicit AC on → On.
    renderSection({ is_ac_on: true, is_climate_on: false })
    expect(screen.getByText('On')).toBeInTheDocument()
    expect(mockT).toHaveBeenCalledWith('common.on', 'On')

    cleanup()
    mockT.mockClear()

    // Explicit AC false must WIN over a truthy climate flag (`??`, not `||`).
    renderSection({ is_ac_on: false, is_climate_on: true })
    expect(screen.queryByText('On')).toBeNull()
    expect(mockT).toHaveBeenCalledWith('common.off', 'Off')

    cleanup()
    mockT.mockClear()

    // AC nullish → fall through to is_climate_on.
    renderSection({ is_ac_on: null, is_climate_on: true })
    expect(screen.getByText('On')).toBeInTheDocument()

    cleanup()
    mockT.mockClear()

    renderSection({ is_ac_on: null, is_climate_on: null })
    expect(screen.queryByText('On')).toBeNull()
    expect(mockT).toHaveBeenCalledWith('common.off', 'Off')
  })

  it('wires every card label to its i18n key (no raw English labels)', () => {
    renderSection()

    const expected: ReadonlyArray<readonly [string, string]> = [
      ['vehicles.detail.climate', 'Climate'],
      ['common.insideTemp', 'Inside Temp'],
      ['common.outsideTemp', 'Outside Temp'],
      ['vehicles.detail.driverSetpoint', 'Driver Setpoint'],
      ['vehicles.detail.fanSpeed', 'Fan Speed'],
      ['vehicles.detail.seatHeaterL', 'Seat Heater Left'],
      ['vehicles.detail.seatHeaterR', 'Seat Heater Right'],
      ['vehicles.detail.defrost', 'Defrost'],
      ['vehicles.detail.climateOn', 'Climate On'],
    ]
    for (const [key, fallback] of expected) {
      expect(mockT).toHaveBeenCalledWith(key, fallback)
    }
  })

  it('marks every decorative glyph (panel + each card icon) aria-hidden', () => {
    const { container } = renderSection()

    const svgs = Array.from(container.querySelectorAll('svg'))
    // One panel-title glyph + one per metric card = nine decorative icons.
    expect(svgs.length).toBeGreaterThanOrEqual(9)
    for (const svg of svgs) {
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    }
  })
})
