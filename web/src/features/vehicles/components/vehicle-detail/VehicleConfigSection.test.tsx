// Behavioural coverage for VehicleConfigSection — the specifications panel on
// the vehicle detail view. It is a pure prop-driven presenter over a
// VehicleConfigSnapshot (+ a fallback softwareVersion), so the contract worth
// pinning is:
//   - a populated snapshot renders the panel title plus all twelve KV rows
//     inside the shared GlassPanel, with each string field echoed verbatim,
//   - the three boolean flags routing through the `!= null` guard: an explicit
//     `false` renders localized "No" (the regression a truthiness check would
//     swallow), a `true` renders "Yes", and a never-reported flag degrades to an
//     em-dash — never "undefined",
//   - software version precedence: snapshot `software_update_version` wins, then
//     the `softwareVersion` prop, then an em-dash,
//   - a null / undefined snapshot degrading to the shared EmptyState (role=status)
//     with an i18n message while the panel title still renders — NOT a blank
//     panel and NOT a perpetual loading shimmer,
//   - every missing optional field collapsing to an em-dash instead of the string
//     "undefined" or an empty cell,
//   - every visible label resolved through i18n (no raw English literals), and
//   - a11y: the decorative panel glyph is aria-hidden.
//
// react-i18next is mocked so `t(key, fallback)` returns the English fallback AND
// records the exact key/fallback each string wires to (mirrors the sibling
// ClimateSection / QuickStatsGrid tests). The real GlassPanel + PanelTitle +
// KVList + EmptyState render, proving the rows mount inside the shared panel
// shell and the empty branch surfaces the shared status region. Nothing here
// touches the network — VehicleConfigSection receives its data as props, and the
// component exposes no user interactions (a pure presenter), so there is no
// userEvent surface to exercise.

import type { ReactNode } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const { mockT } = vi.hoisted(() => ({
  mockT: vi.fn((_key: string, fallback?: string) => fallback ?? _key),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockT }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}))

import { VehicleConfigSection } from './VehicleConfigSection'
import type { VehicleConfigSnapshot } from '@/api/types'

const DASH = '—'

// A fully-populated snapshot whose values are all distinct from "Yes" / "No" /
// the em-dash placeholder, so every rendered row is unambiguous in assertions.
// Booleans are non-null (true→Yes, false→No) and the software version is set, so
// the baseline render produces ZERO em-dashes — overrides can then count dashes
// deterministically.
const fullConfig: VehicleConfigSnapshot = {
  id: 7,
  vehicle_id: 42,
  car_type: 'models',
  trim: 'P100D',
  exterior_color: 'DeepBlueMetallic',
  roof_color: 'GlassRoof',
  wheel_type: 'Turbine22',
  rear_seat_heaters: 'Both',
  sunroof_installed: 'None',
  efficiency_package: 'Default',
  europe_vehicle: false,
  right_hand_drive: true,
  remote_start_enabled: true,
  charge_port: 'US-Combo',
  offroad_lightbar_present: false,
  version: 'v3',
  vehicle_name: 'Bluey',
  software_update_version: '2025.20.1',
  created_at: '2025-01-01T00:00:00Z',
}

function renderConfig(
  overrides: Partial<VehicleConfigSnapshot> = {},
  softwareVersion: string | undefined = undefined,
) {
  return render(
    <VehicleConfigSection
      vehicleConfig={{ ...fullConfig, ...overrides }}
      softwareVersion={softwareVersion}
    />,
  )
}

const CONFIG_LABELS = [
  'Car Type',
  'Trim',
  'Exterior Color',
  'Wheels',
  'Roof Color',
  'Charge Port',
  'Right-Hand Drive',
  'Europe Vehicle',
  'Offroad Lightbar',
  'Rear Seat Heaters',
  'Sunroof',
  'Software',
] as const

beforeEach(() => {
  mockT.mockClear()
})
afterEach(cleanup)

describe('VehicleConfigSection', () => {
  it('renders the panel title and all twelve config rows inside the shared glass panel', () => {
    const { container } = renderConfig()

    // The heading (h3 via PanelTitle) is always present — the section is never
    // hidden, even in the empty branch.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Vehicle Configuration' }),
    ).toBeInTheDocument()

    for (const label of CONFIG_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }

    // Mounted inside the shared GlassPanel shell (data-print-card marker).
    expect(container.querySelector('[data-print-card]')).not.toBeNull()
    // No EmptyState placeholder when data is present.
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('echoes each string field value verbatim from the snapshot', () => {
    renderConfig()

    for (const value of [
      'models',
      'P100D',
      'DeepBlueMetallic',
      'Turbine22',
      'GlassRoof',
      'US-Combo',
      'Both',
      'None',
      '2025.20.1',
    ]) {
      expect(screen.getByText(value)).toBeInTheDocument()
    }
    // A present snapshot never emits the em-dash placeholder for populated rows.
    expect(screen.queryByText(DASH)).toBeNull()
  })

  it('formats boolean flags as localized Yes / No', () => {
    // fullConfig: right_hand_drive=true (Yes), europe_vehicle=false (No),
    // offroad_lightbar_present=false (No).
    renderConfig()

    expect(screen.getAllByText('Yes')).toHaveLength(1)
    expect(screen.getAllByText('No')).toHaveLength(2)
    expect(mockT).toHaveBeenCalledWith('common.yes', 'Yes')
    expect(mockT).toHaveBeenCalledWith('common.no', 'No')
  })

  it('renders an explicit false as "No", not an em-dash (regression: != null, not truthiness)', () => {
    // Only right_hand_drive is a concrete false; the other two flags are unset.
    renderConfig({
      right_hand_drive: false,
      europe_vehicle: null as unknown as undefined,
      offroad_lightbar_present: null as unknown as undefined,
    })

    // A `flag ? 'Yes' : 'No'` without the null guard would still show "No" here,
    // but the OTHER two unset flags prove the guard: they must be em-dashes.
    expect(screen.getAllByText('No')).toHaveLength(1)
    expect(screen.queryByText('Yes')).toBeNull()
    expect(screen.getAllByText(DASH)).toHaveLength(2)
  })

  it('shows an em-dash for boolean flags that were never reported (no "undefined")', () => {
    renderConfig({
      right_hand_drive: undefined,
      europe_vehicle: undefined,
      offroad_lightbar_present: undefined,
    })

    expect(screen.queryByText('Yes')).toBeNull()
    expect(screen.queryByText('No')).toBeNull()
    expect(screen.getAllByText(DASH)).toHaveLength(3)
    expect(screen.queryByText('undefined')).toBeNull()
  })

  it('prefers the snapshot software version, then the prop, then an em-dash', () => {
    // 1. Snapshot version wins over the prop.
    renderConfig({}, '2099.9-fallback')
    expect(screen.getByText('2025.20.1')).toBeInTheDocument()
    expect(screen.queryByText('2099.9-fallback')).toBeNull()

    cleanup()

    // 2. Missing snapshot version falls back to the prop.
    renderConfig({ software_update_version: undefined }, '2099.9-fallback')
    expect(screen.getByText('2099.9-fallback')).toBeInTheDocument()

    cleanup()

    // 3. Neither present → the Software row is the single em-dash (every other
    //    field in fullConfig is populated), never "undefined".
    renderConfig({ software_update_version: undefined }, undefined)
    expect(screen.getAllByText(DASH)).toHaveLength(1)
    expect(screen.queryByText('undefined')).toBeNull()
  })

  it('shows the shared EmptyState (never a blank panel) when the snapshot is null', () => {
    render(<VehicleConfigSection vehicleConfig={null} softwareVersion="2025.1" />)

    // Title still renders; the body degrades to the i18n empty message.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Vehicle Configuration' }),
    ).toBeInTheDocument()
    const empty = screen.getByRole('status')
    expect(empty).toHaveTextContent('No configuration data available')
    expect(mockT).toHaveBeenCalledWith(
      'vehicles.detail.noVehicleConfig',
      'No configuration data available',
    )

    // None of the config rows leak through in the empty branch.
    expect(screen.queryByText('Car Type')).toBeNull()
    expect(screen.queryByText('Software')).toBeNull()
  })

  it('treats an undefined snapshot the same as null (empty state, no throw)', () => {
    expect(() =>
      render(<VehicleConfigSection vehicleConfig={undefined} softwareVersion={undefined} />),
    ).not.toThrow()

    expect(screen.getByRole('status')).toHaveTextContent('No configuration data available')
    expect(screen.queryByText('Trim')).toBeNull()
  })

  it('renders an em-dash for every missing field instead of "undefined" or a blank cell', () => {
    // A bare snapshot (only the required keys) — every displayed optional field
    // is absent, so all twelve rows collapse to the placeholder.
    render(
      <VehicleConfigSection
        vehicleConfig={{ id: 1, vehicle_id: 1, created_at: '2025-01-01T00:00:00Z' }}
        softwareVersion={undefined}
      />,
    )

    // Labels are still present (the section never blanks out)…
    expect(screen.getByText('Car Type')).toBeInTheDocument()
    // …all twelve value cells are em-dashes…
    expect(screen.getAllByText(DASH)).toHaveLength(12)
    // …never the literal "undefined", and this is the data branch (not empty).
    expect(screen.queryByText('undefined')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('wires every visible label to its i18n key (no raw English labels)', () => {
    renderConfig()

    const expected: ReadonlyArray<readonly [string, string]> = [
      ['vehicles.detail.vehicleConfig', 'Vehicle Configuration'],
      ['vehicles.detail.carType', 'Car Type'],
      ['vehicles.detail.trim', 'Trim'],
      ['vehicles.detail.color', 'Exterior Color'],
      ['vehicles.detail.wheels', 'Wheels'],
      ['vehicles.detail.roofColor', 'Roof Color'],
      ['vehicles.detail.chargePort', 'Charge Port'],
      ['vehicles.detail.rhd', 'Right-Hand Drive'],
      ['vehicles.detail.europeVehicle', 'Europe Vehicle'],
      ['vehicles.detail.offroadLightbar', 'Offroad Lightbar'],
      ['vehicles.detail.rearSeatHeaters', 'Rear Seat Heaters'],
      ['vehicles.detail.sunroofInstalled', 'Sunroof'],
      ['vehicles.detail.softwareVersion', 'Software'],
    ]
    for (const [key, fallback] of expected) {
      expect(mockT).toHaveBeenCalledWith(key, fallback)
    }
  })

  it('marks the decorative panel glyph aria-hidden (icon-only, non-semantic)', () => {
    const { container } = renderConfig()

    const svgs = Array.from(container.querySelectorAll('svg'))
    expect(svgs.length).toBeGreaterThanOrEqual(1)
    for (const svg of svgs) {
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    }
  })
})
