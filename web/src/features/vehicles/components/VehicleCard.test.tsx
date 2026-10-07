/**
 * VehicleCard — behaviour, hardening & a11y coverage.
 *
 * VehicleCard renders one fleet card: a Tesla silhouette, the vehicle
 * name / VIN / status pill, a live-state stats row (battery, range, interior
 * temp, odometer, charge power, lock / sentry flags), and two icon-only row
 * actions (open detail / remove). Live state comes from `useVehicleState`,
 * unit display flows through `useUnits`, and the status pill is derived by the
 * real `getVehicleStatus`.
 *
 * Strategy (mirrors the LiveStateIndicators / VehicleListPage suites):
 *   - `useVehicleState` is mocked at the hook boundary so loading / error /
 *     empty / happy branches are deterministic and no network is touched.
 *   - `getVehicleStatus` (re-exported from the same module) is kept REAL via
 *     importActual, so the offline / charging / driving / online derivation is
 *     exercised end-to-end.
 *   - `parseModelKey` is kept REAL while `TeslaCarViz` is a prop-surfacing
 *     stub, so the model-string → silhouette-key mapping is asserted directly.
 *   - `StatusBadge` / `ProgressRing` are thin stubs that surface their props
 *     as data-attributes (status / gauge value + colour) without coupling to
 *     their Tailwind internals.
 *   - `useUnits` exposes spy formatters so the SI values handed to the display
 *     boundary are assertable; the odometer path runs through the REAL
 *     `convertDistanceFromSI` + `fmtInt`.
 *   - `react-i18next` echoes the English fallback and interpolates `{{name}}`
 *     so the interpolated aria-labels read naturally in assertions.
 *
 * It also locks in the hardening applied while elevating the file:
 *   - null-safe battery (`?? 0`) so a null `battery_level` renders "0%" and a
 *     zeroed gauge instead of "%" / a NaN ring;
 *   - null-safe charge power (`?? 0`) so a charging car with a null
 *     `charger_power` renders "0 kW";
 *   - a loading / error / empty placeholder (role="status") instead of a blank
 *     stats area when there is no live state;
 *   - accessible names on the icon-only open / remove controls and the
 *     lock / sentry status icons.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

import type { Vehicle, VehicleState } from '@/api/types'

// ── Spy unit formatters shared with the `useUnits` mock. Finite → a tagged,
//    assertable string; null / undefined / NaN → the lib em-dash fallback. ──
const mocks = vi.hoisted(() => ({
  formatDistance: vi.fn((v: number | null | undefined) =>
    typeof v === 'number' && Number.isFinite(v) ? `dist:${v}` : '—',
  ),
  formatTemperature: vi.fn((v: number | null | undefined) =>
    typeof v === 'number' && Number.isFinite(v) ? `temp:${v}` : '—',
  ),
}))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km' },
    formatDistance: mocks.formatDistance,
    formatTemperature: mocks.formatTemperature,
  }),
}))

// Echo the English fallback; interpolate `{{name}}` so aria-labels read
// naturally. A bare key (no string fallback) echoes the key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: unknown) => {
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>
          return fallback.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          )
        }
        return fallback
      }
      return key
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}))

// Keep `parseModelKey` REAL; stub `TeslaCarViz` to surface its prop wiring.
vi.mock('@/components/data-display/TeslaCarViz', async (importActual) => {
  const actual =
    await importActual<typeof import('@/components/data-display/TeslaCarViz')>()
  return {
    ...actual,
    TeslaCarViz: (props: {
      model?: string
      batteryLevel?: number
      isCharging?: boolean
      isLocked?: boolean
      sentryMode?: boolean
    }) => (
      <div
        data-testid="car-viz"
        data-model={String(props.model)}
        data-battery={String(props.batteryLevel)}
        data-charging={String(props.isCharging)}
        data-locked={String(props.isLocked)}
        data-sentry={String(props.sentryMode)}
      />
    ),
  }
})

vi.mock('@/components/data-display/StatusBadge', () => ({
  StatusBadge: ({ status }: { status: string }) => (
    <span data-testid="status-badge" data-status={status}>
      {status}
    </span>
  ),
}))

vi.mock('@/components/data-display/ProgressRing', () => ({
  ProgressRing: ({ value, color }: { value: number; color?: string }) => (
    <div data-testid="progress-ring" data-value={String(value)} data-color={String(color)} />
  ),
}))

// `useVehicleState` is controllable; `getVehicleStatus` stays REAL.
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>()
  return { ...actual, useVehicleState: vi.fn() }
})

import { VehicleCard } from './VehicleCard'
import { useVehicleState } from '@/api/hooks/useVehicles'

const mockUseVehicleState = vi.mocked(useVehicleState)

function makeVehicle(over: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1,
    vehicle_id: 1,
    vin: '5YJ3E1EA7KF000001',
    display_name: 'Model 3 Alpha',
    model: 'Model 3',
    trim_badging: 'Performance',
    exterior_color: 'Red',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    ...over,
  }
}

function makeState(over: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 72,
    rated_range: 400_000,
    ideal_range: 420_000,
    odometer: 12_345_678,
    inside_temp: 21,
    outside_temp: 15,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '2024.0',
    ...over,
  }
}

/** Minimal `UseQueryResult`-shaped stub for `useVehicleState`. */
 
function stateQuery(over: Record<string, unknown> = {}): any {
  return { data: undefined, isLoading: false, isError: false, error: null, ...over }
}

/** Resolved happy query carrying a live `VehicleState`. */
function withState(state: Partial<VehicleState> = {}) {
  return stateQuery({ data: { state: makeState(state), live: true } })
}

function renderCard(
  over: { vehicle?: Partial<Vehicle>; onDelete?: (v: Vehicle) => void } = {},
) {
  const vehicle = makeVehicle(over.vehicle)
  const onDelete = over.onDelete ?? vi.fn()
  const utils = render(
    <MemoryRouter>
      <VehicleCard vehicle={vehicle} onDelete={onDelete} />
    </MemoryRouter>,
  )
  return { ...utils, vehicle, onDelete }
}

beforeEach(() => {
  mocks.formatDistance.mockClear()
  mocks.formatTemperature.mockClear()
  mockUseVehicleState.mockReset()
  mockUseVehicleState.mockReturnValue(withState())
})

describe('VehicleCard — header', () => {
  it('renders the display name as a heading link to the detail route', () => {
    const heading = renderCard().container
    const link = screen.getByRole('link', { name: 'Model 3 Alpha' })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/vehicles/1')
    expect(heading).toHaveTextContent('Model 3 Alpha')
  })

  it('shows the model, trim and VIN in the subtitle', () => {
    const { container } = renderCard()
    expect(container).toHaveTextContent('Model 3 Performance')
    expect(screen.getByText('5YJ3E1EA7KF000001')).toBeInTheDocument()
  })

  it('falls back to the VIN when the display name is blank', () => {
    renderCard({ vehicle: { display_name: '' } })
    // Heading link's accessible name collapses to the VIN.
    expect(screen.getByRole('link', { name: '5YJ3E1EA7KF000001' })).toBeInTheDocument()
  })
})

describe('VehicleCard — status derivation (real getVehicleStatus)', () => {
  it('shows "offline" when there is no live state', () => {
    mockUseVehicleState.mockReturnValue(stateQuery())
    renderCard()
    expect(screen.getByTestId('status-badge')).toHaveAttribute('data-status', 'offline')
  })

  it('shows "charging" when the vehicle is charging', () => {
    mockUseVehicleState.mockReturnValue(withState({ is_charging: true }))
    renderCard()
    expect(screen.getByTestId('status-badge')).toHaveAttribute('data-status', 'charging')
  })

  it('shows "driving" when the vehicle is moving', () => {
    mockUseVehicleState.mockReturnValue(withState({ speed: 42 }))
    renderCard()
    expect(screen.getByTestId('status-badge')).toHaveAttribute('data-status', 'driving')
  })

  it('shows "online" for a parked, awake vehicle', () => {
    mockUseVehicleState.mockReturnValue(withState({ state: 'online', speed: 0, is_charging: false }))
    renderCard()
    expect(screen.getByTestId('status-badge')).toHaveAttribute('data-status', 'online')
  })
})

describe('VehicleCard — silhouette wiring', () => {
  it('maps the model string to a silhouette key via the real parseModelKey', () => {
    renderCard({ vehicle: { model: 'Model Y' } })
    expect(screen.getByTestId('car-viz')).toHaveAttribute('data-model', 'modely')
  })

  it('forwards live lock / charge / sentry flags and battery to the silhouette', () => {
    mockUseVehicleState.mockReturnValue(
      withState({ is_locked: false, is_charging: true, sentry_mode: true, battery_level: 30 }),
    )
    renderCard()
    const viz = screen.getByTestId('car-viz')
    expect(viz).toHaveAttribute('data-locked', 'false')
    expect(viz).toHaveAttribute('data-charging', 'true')
    expect(viz).toHaveAttribute('data-sentry', 'true')
    expect(viz).toHaveAttribute('data-battery', '30')
  })

  it('defaults the silhouette to a locked, mid-charge car when state is absent', () => {
    mockUseVehicleState.mockReturnValue(stateQuery())
    renderCard()
    const viz = screen.getByTestId('car-viz')
    expect(viz).toHaveAttribute('data-battery', '50')
    expect(viz).toHaveAttribute('data-locked', 'true')
    expect(viz).toHaveAttribute('data-charging', 'false')
  })
})

describe('VehicleCard — live stats', () => {
  it('renders battery %, gauge value and range / temp through the unit boundary', () => {
    mockUseVehicleState.mockReturnValue(
      withState({ battery_level: 72, rated_range: 400_000, inside_temp: 21 }),
    )
    renderCard()

    expect(screen.getByText('72%')).toBeInTheDocument()
    const ring = screen.getByTestId('progress-ring')
    expect(ring).toHaveAttribute('data-value', '72')
    expect(ring).toHaveAttribute('data-color', '#10b981') // batteryColor(72) → good/green

    // SI values are forwarded verbatim to the display boundary.
    expect(mocks.formatDistance).toHaveBeenCalledWith(400_000)
    expect(screen.getByText('dist:400000')).toBeInTheDocument()
    expect(mocks.formatTemperature).toHaveBeenCalledWith(21)
    expect(screen.getByText('temp:21')).toBeInTheDocument()
  })

  it('converts the SI odometer through the real convertDistanceFromSI + fmtInt', () => {
    mockUseVehicleState.mockReturnValue(withState({ odometer: 12_345_678 }))
    const { container } = renderCard()
    // 12_345_678 m ÷ 1000 = 12_345.678 km → fmtInt → "12,346".
    expect(container).toHaveTextContent('12,346')
    expect(screen.getByText('km')).toBeInTheDocument()
  })

  it('colours the gauge red for a low battery', () => {
    mockUseVehicleState.mockReturnValue(withState({ battery_level: 8 }))
    renderCard()
    expect(screen.getByTestId('progress-ring')).toHaveAttribute('data-color', '#ef4444')
  })
})

describe('VehicleCard — charging block', () => {
  it('shows charge power and label only while charging', () => {
    mockUseVehicleState.mockReturnValue(withState({ is_charging: true, charger_power: 48 }))
    renderCard()
    expect(screen.getByText('48 kW')).toBeInTheDocument()
    expect(screen.getByText('Charging')).toBeInTheDocument()
  })

  it('hides the charge block when not charging', () => {
    mockUseVehicleState.mockReturnValue(withState({ is_charging: false }))
    renderCard()
    expect(screen.queryByText('Charging')).not.toBeInTheDocument()
    expect(screen.queryByText(/kW$/)).not.toBeInTheDocument()
  })
})

describe('VehicleCard — lock & sentry indicators', () => {
  it('exposes a labelled lock icon when the car is locked', () => {
    mockUseVehicleState.mockReturnValue(withState({ is_locked: true, sentry_mode: false }))
    renderCard()
    expect(screen.getByRole('img', { name: 'Locked' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Sentry mode on' })).not.toBeInTheDocument()
  })

  it('exposes a labelled sentry icon when sentry mode is on', () => {
    mockUseVehicleState.mockReturnValue(withState({ is_locked: false, sentry_mode: true }))
    renderCard()
    expect(screen.getByRole('img', { name: 'Sentry mode on' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Locked' })).not.toBeInTheDocument()
  })
})

describe('VehicleCard — non-happy live-state branches', () => {
  it('shows a status placeholder while the live state loads', () => {
    mockUseVehicleState.mockReturnValue(stateQuery({ isLoading: true }))
    renderCard()
    expect(screen.getByRole('status')).toHaveTextContent('Loading live state…')
    // No stats gauge is rendered without a resolved state.
    expect(screen.queryByTestId('progress-ring')).not.toBeInTheDocument()
  })

  it('shows an error placeholder when the live-state query fails', () => {
    mockUseVehicleState.mockReturnValue(stateQuery({ isError: true }))
    renderCard()
    expect(screen.getByRole('status')).toHaveTextContent('Live state unavailable')
  })

  it('shows an empty placeholder when there is simply no telemetry', () => {
    mockUseVehicleState.mockReturnValue(stateQuery())
    renderCard()
    expect(screen.getByRole('status')).toHaveTextContent('No live telemetry yet')
  })
})

describe('VehicleCard — null safety (regression guards)', () => {
  it('renders "0%" and a zeroed gauge when battery_level is null', () => {
    mockUseVehicleState.mockReturnValue(
      withState({ battery_level: null as unknown as number }),
    )
    renderCard()
    expect(screen.getByText('0%')).toBeInTheDocument()
    const ring = screen.getByTestId('progress-ring')
    expect(ring).toHaveAttribute('data-value', '0')
    expect(ring.getAttribute('data-value')).not.toContain('NaN')
  })

  it('renders "0 kW" when charging with a null charger_power', () => {
    mockUseVehicleState.mockReturnValue(
      withState({ is_charging: true, charger_power: null as unknown as number }),
    )
    renderCard()
    expect(screen.getByText('0 kW')).toBeInTheDocument()
  })

  it('falls back to an em dash when range and temperature are null', () => {
    mockUseVehicleState.mockReturnValue(
      withState({
        rated_range: null as unknown as number,
        inside_temp: null as unknown as number,
      }),
    )
    renderCard()
    expect(mocks.formatDistance).toHaveBeenCalledWith(null)
    expect(mocks.formatTemperature).toHaveBeenCalledWith(null)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })
})

describe('VehicleCard — actions & accessibility', () => {
  it('calls onDelete with the vehicle when the remove control is clicked', () => {
    const onDelete = vi.fn()
    const { vehicle } = renderCard({ onDelete })
    fireEvent.click(screen.getByRole('button', { name: 'Remove Model 3 Alpha' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith(vehicle)
  })

  it('gives the icon-only open and remove controls accessible names', () => {
    renderCard()
    expect(
      screen.getByRole('link', { name: 'View details for Model 3 Alpha' }),
    ).toHaveAttribute('href', '/vehicles/1')
    expect(
      screen.getByRole('button', { name: 'Remove Model 3 Alpha' }),
    ).toBeInTheDocument()
  })
})
