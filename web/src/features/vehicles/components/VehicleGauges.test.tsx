/**
 * VehicleGauges unit tests.
 *
 * VehicleGauges is the hero telemetry surface of the vehicle-detail page. It
 * takes an SI-canonical `VehicleState` (meters, m/s, m/h) plus a `Vehicle`, and
 * fans the data out to a car visualisation, four radial gauges (battery / range
 * / speed / power), a stack of metric bars, and a row of status chips. Every
 * physical quantity is converted at the display boundary through the user's
 * `useUnits()` preference — the gauges must receive matching value/max pairs in
 * the SAME unit so the arc fill reflects the real physical ratio.
 *
 * Strategy: the heavy presentational children (TeslaCarViz, RadialGauge,
 * MetricBar) are stubbed so each renders its props as inspectable data-*
 * attributes. That lets these tests pin the *container's* responsibility —
 * SI→display conversion, null-safety, unit labelling, conditional rendering,
 * and prop wiring — precisely and deterministically, without dragging in the
 * ThemeProvider that TeslaCarViz's SVG needs. `parseModelKey` is kept real so
 * the model-string → key mapping is exercised end-to-end. `useUnits` is mocked
 * behind a mutable holder so both the metric (km/km-h) and imperial (mi/mph)
 * preferences are covered, and `formatDistance` is a spy so we can assert the
 * component formats the raw SI value (never a pre-converted magnitude).
 *
 * Coverage:
 *   1. Four radial gauges render with correct SI→km conversions + unit labels.
 *   2. Speed converts to km/h and the gauge colour reflects moving vs parked.
 *   3. The battery gauge colour follows the good/warn/bad level bands.
 *   4. Battery + range metric bars always render; the charge-rate bar is hidden
 *      while not charging, and `formatDistance` is fed the raw SI range.
 *   5. The charge-rate bar appears while charging with a converted value, an
 *      SI-sourced "/h" sublabel, and the power gauge turns charging-green.
 *   6. The imperial preference re-labels + re-scales range and speed to mi/mph.
 *   7. The status chips reflect lock / sentry / climate / software state both
 *      ways round.
 *   8. An empty software version degrades to the i18n "N/A" fallback.
 *   9. a11y: every decorative chip icon is aria-hidden and colour-coded.
 *  10. TeslaCarViz receives the coalesced telemetry + the parsed model key.
 *  11. Resilience: absent numeric telemetry never reaches a gauge/bar as NaN.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { Vehicle, VehicleState } from '@/api/types'

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

// FadeIn is a pure framer-motion animation wrapper — pass children straight
// through so the test tree is deterministic and free of matchMedia/IO timing.
vi.mock('@/components/motion/FadeIn', () => ({
  FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</>,
}))

// TeslaCarViz renders a themed SVG via useTheme() (throws without a
// ThemeProvider). Stub the component but keep the real `parseModelKey` so the
// model-string → key mapping is genuinely exercised by the container.
vi.mock('@/components/data-display/TeslaCarViz', async () => {
  const actual = await vi.importActual<typeof import('@/components/data-display/TeslaCarViz')>(
    '@/components/data-display/TeslaCarViz',
  )
  return {
    ...actual,
    TeslaCarViz: (props: {
      batteryLevel: number
      isCharging: boolean
      isLocked: boolean
      isClimateOn: boolean
      sentryMode: boolean
      speed: number
      model?: string
      size?: string
    }) => (
      <div
        data-testid="car-viz"
        data-battery={String(props.batteryLevel)}
        data-charging={String(props.isCharging)}
        data-locked={String(props.isLocked)}
        data-climate={String(props.isClimateOn)}
        data-sentry={String(props.sentryMode)}
        data-speed={String(props.speed)}
        data-model={props.model ?? ''}
        data-size={props.size ?? ''}
      />
    ),
  }
})

vi.mock('@/components/charts/RadialGauge', () => ({
  RadialGauge: (props: {
    value: number
    max: number
    label: string
    unit?: string
    color?: string
    size?: number
  }) => (
    <div
      data-testid={`gauge-${props.label}`}
      data-value={String(props.value)}
      data-max={String(props.max)}
      data-unit={props.unit ?? ''}
      data-color={props.color ?? ''}
    >
      {props.label}
    </div>
  ),
}))

vi.mock('@/components/data-display/MetricBar', () => ({
  MetricBar: (props: {
    value: number
    max: number
    color: string
    label: string
    sublabel?: string
  }) => (
    <div
      data-testid={`bar-${props.label}`}
      data-value={String(props.value)}
      data-max={String(props.max)}
      data-color={props.color}
      data-sublabel={props.sublabel ?? ''}
    >
      {props.label}
    </div>
  ),
}))

// Mutable unit-preference holder. The component calls the REAL
// convertDistanceFromSI/convertSpeedFromSI with `unitPrefs.distance/speed`, so
// flipping these fields drives genuine conversion math; `formatDistance` is a
// spy that echoes the raw SI value it is handed for boundary assertions.
const mockUnits = vi.hoisted(() => ({
  distance: 'km' as 'km' | 'mi',
  speed: 'km/h' as 'km/h' | 'mph',
  formatDistance: vi.fn((v?: number | null) => `SI:${v ?? 0}`),
}))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: mockUnits.distance, speed: mockUnits.speed },
    formatDistance: mockUnits.formatDistance,
  }),
}))

import { VehicleGauges } from './VehicleGauges'

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1,
    vehicle_id: 1,
    vin: '5YJ3E1EAXTF000001',
    display_name: 'Rocinante',
    model: 'Model 3',
    trim_badging: 'p',
    exterior_color: 'MidnightSilver',
    wheel_type: 'Stiletto20',
    state: 'online',
    healthy: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 37.4,
    longitude: -122.1,
    heading: 0,
    speed: 0,
    power: 0,
    battery_level: 82,
    rated_range: 400000, // 400 km / ~249 mi in SI meters
    ideal_range: 420000,
    odometer: 12_000_000,
    inside_temp: 21,
    outside_temp: 15,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '2026.4.1',
    ...overrides,
  }
}

beforeEach(() => {
  mockUnits.distance = 'km'
  mockUnits.speed = 'km/h'
  mockUnits.formatDistance.mockClear()
})

describe('VehicleGauges — radial gauges (metric)', () => {
  it('renders all four gauges with SI→km conversions and unit labels', () => {
    render(<VehicleGauges vehicle={makeVehicle()} state={makeState()} />)

    const battery = screen.getByTestId('gauge-Battery')
    expect(battery).toHaveAttribute('data-value', '82')
    expect(battery).toHaveAttribute('data-max', '100')
    expect(battery).toHaveAttribute('data-unit', '%')

    // 400 000 m / 1000 = 400 km; upper bound 965 606.4 m → 966 km.
    const range = screen.getByTestId('gauge-Range')
    expect(range).toHaveAttribute('data-value', '400')
    expect(range).toHaveAttribute('data-max', '966')
    expect(range).toHaveAttribute('data-unit', 'km')

    // Parked: 0 m/s → 0 km/h; upper bound 111.76 m/s → 402 km/h.
    const speed = screen.getByTestId('gauge-Speed')
    expect(speed).toHaveAttribute('data-value', '0')
    expect(speed).toHaveAttribute('data-max', '402')
    expect(speed).toHaveAttribute('data-unit', 'km/h')

    const power = screen.getByTestId('gauge-Power')
    expect(power).toHaveAttribute('data-value', '0')
    expect(power).toHaveAttribute('data-unit', 'kW')
  })

  it('converts speed to km/h and colours the speed gauge by motion', () => {
    const { rerender } = render(
      <VehicleGauges vehicle={makeVehicle()} state={makeState({ speed: 25 })} />,
    )

    // 25 m/s × 3600 / 1000 = 90 km/h.
    const moving = screen.getByTestId('gauge-Speed')
    expect(moving).toHaveAttribute('data-value', '90')
    expect(moving).toHaveAttribute('data-color', '#a855f7') // COLOR.PURPLE while moving

    rerender(<VehicleGauges vehicle={makeVehicle()} state={makeState({ speed: 0 })} />)
    expect(screen.getByTestId('gauge-Speed')).toHaveAttribute('data-color', '#374151') // COLOR.DARK parked
  })

  it('colours the battery gauge by the good / warn / bad level bands', () => {
    const { rerender } = render(
      <VehicleGauges vehicle={makeVehicle()} state={makeState({ battery_level: 82 })} />,
    )
    expect(screen.getByTestId('gauge-Battery')).toHaveAttribute('data-color', '#10b981') // good

    rerender(<VehicleGauges vehicle={makeVehicle()} state={makeState({ battery_level: 50 })} />)
    expect(screen.getByTestId('gauge-Battery')).toHaveAttribute('data-color', '#f59e0b') // warn

    rerender(<VehicleGauges vehicle={makeVehicle()} state={makeState({ battery_level: 12 })} />)
    expect(screen.getByTestId('gauge-Battery')).toHaveAttribute('data-color', '#ef4444') // bad
  })
})

describe('VehicleGauges — metric bars', () => {
  it('always shows battery + range bars and hides charge-rate while not charging', () => {
    render(<VehicleGauges vehicle={makeVehicle()} state={makeState({ is_charging: false })} />)

    const battery = screen.getByTestId('bar-Battery Level')
    expect(battery).toHaveAttribute('data-value', '82')
    expect(battery).toHaveAttribute('data-sublabel', '82%')

    const range = screen.getByTestId('bar-Estimated Range')
    expect(range).toHaveAttribute('data-value', '400')
    // The sublabel must be produced from the raw SI range, not a pre-converted
    // magnitude — proving the display-boundary conversion contract.
    expect(range).toHaveAttribute('data-sublabel', 'SI:400000')
    expect(mockUnits.formatDistance).toHaveBeenCalledWith(400000)

    expect(screen.queryByTestId('bar-Charge Rate')).toBeNull()
  })

  it('shows the charge-rate bar and greens the power gauge while charging', () => {
    render(
      <VehicleGauges
        vehicle={makeVehicle()}
        state={makeState({ is_charging: true, charge_rate: 160000, charger_power: 48 })}
      />,
    )

    // 160 000 m/h / 1000 = 160 km/h-equivalent range added per hour.
    const chargeBar = screen.getByTestId('bar-Charge Rate')
    expect(chargeBar).toHaveAttribute('data-value', '160')
    expect(chargeBar).toHaveAttribute('data-sublabel', 'SI:160000/h')
    expect(mockUnits.formatDistance).toHaveBeenCalledWith(160000)

    const power = screen.getByTestId('gauge-Power')
    expect(power).toHaveAttribute('data-value', '48')
    expect(power).toHaveAttribute('data-color', '#10b981') // charging → boolColorMuted(true)
  })
})

describe('VehicleGauges — imperial preference', () => {
  it('re-labels and re-scales range + speed to mi / mph', () => {
    mockUnits.distance = 'mi'
    mockUnits.speed = 'mph'

    render(<VehicleGauges vehicle={makeVehicle()} state={makeState({ speed: 25 })} />)

    // 400 000 m / 1609.344 ≈ 248.5 → 249 mi; upper bound 965 606.4 m → 600 mi.
    const range = screen.getByTestId('gauge-Range')
    expect(range).toHaveAttribute('data-value', '249')
    expect(range).toHaveAttribute('data-max', '600')
    expect(range).toHaveAttribute('data-unit', 'mi')

    // 25 m/s × 3600 / 1609.344 ≈ 55.9 → 56 mph; upper bound 111.76 m/s → 250 mph.
    const speed = screen.getByTestId('gauge-Speed')
    expect(speed).toHaveAttribute('data-value', '56')
    expect(speed).toHaveAttribute('data-max', '250')
    expect(speed).toHaveAttribute('data-unit', 'mph')
  })
})

describe('VehicleGauges — status chips', () => {
  it('reflects locked / sentry-off / climate-off / software state', () => {
    render(
      <VehicleGauges
        vehicle={makeVehicle()}
        state={makeState({
          is_locked: true,
          sentry_mode: false,
          is_climate_on: false,
          software_version: '2026.4.1',
        })}
      />,
    )

    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.getByText('Sentry OFF')).toBeInTheDocument()
    expect(screen.getByText('Climate OFF')).toBeInTheDocument()
    expect(screen.getByText('2026.4.1')).toBeInTheDocument()
    expect(screen.queryByText('Unlocked')).toBeNull()
  })

  it('reflects the inverse unlocked / sentry-on / climate-on state', () => {
    render(
      <VehicleGauges
        vehicle={makeVehicle()}
        state={makeState({ is_locked: false, sentry_mode: true, is_climate_on: true })}
      />,
    )

    expect(screen.getByText('Unlocked')).toBeInTheDocument()
    expect(screen.getByText('Sentry ON')).toBeInTheDocument()
    expect(screen.getByText('Climate ON')).toBeInTheDocument()
    expect(screen.queryByText('Locked')).toBeNull()
  })

  it('falls back to the i18n "N/A" label when the software version is empty', () => {
    render(
      <VehicleGauges vehicle={makeVehicle()} state={makeState({ software_version: '' })} />,
    )

    expect(screen.getByText('N/A')).toBeInTheDocument()
  })
})

describe('VehicleGauges — accessibility', () => {
  it('marks every chip icon aria-hidden and colour-codes the lock icon', () => {
    const { container } = render(
      <VehicleGauges vehicle={makeVehicle()} state={makeState({ is_locked: true })} />,
    )

    // The stubbed gauges/bars/car-viz render no SVGs, so the only icons in the
    // tree are the four decorative chip icons.
    const icons = container.querySelectorAll('svg')
    expect(icons).toHaveLength(4)
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'))

    const lockIcon = (screen.getByText('Locked').parentElement as HTMLElement).querySelector('svg')
    expect(lockIcon).toHaveStyle({ color: 'rgb(16, 185, 129)' }) // boolColor(true) → green
  })
})

describe('VehicleGauges — car visualisation wiring', () => {
  it('forwards coalesced telemetry and the parsed model key to TeslaCarViz', () => {
    render(
      <VehicleGauges
        vehicle={makeVehicle({ model: 'Model Y' })}
        state={makeState({ battery_level: 73, is_charging: true, speed: 10, is_locked: false })}
      />,
    )

    const viz = screen.getByTestId('car-viz')
    expect(viz).toHaveAttribute('data-battery', '73')
    expect(viz).toHaveAttribute('data-charging', 'true')
    expect(viz).toHaveAttribute('data-locked', 'false')
    expect(viz).toHaveAttribute('data-speed', '10')
    // parseModelKey('Model Y') → 'modely' (kept real via importActual).
    expect(viz).toHaveAttribute('data-model', 'modely')
  })
})

describe('VehicleGauges — null-safety', () => {
  it('never lets absent numeric telemetry reach a gauge or bar as NaN', () => {
    render(
      <VehicleGauges
        vehicle={makeVehicle()}
        state={makeState({
          battery_level: undefined,
          rated_range: undefined,
          speed: undefined,
          charge_rate: undefined,
          charger_power: undefined,
        })}
      />,
    )

    // Pre-hardening these produced NaN (Math.round(convertFromSI(undefined))).
    expect(screen.getByTestId('gauge-Battery')).toHaveAttribute('data-value', '0')
    expect(screen.getByTestId('gauge-Range')).toHaveAttribute('data-value', '0')
    expect(screen.getByTestId('gauge-Speed')).toHaveAttribute('data-value', '0')
    expect(screen.getByTestId('gauge-Power')).toHaveAttribute('data-value', '0')
    expect(screen.getByTestId('bar-Battery Level')).toHaveAttribute('data-value', '0')
    expect(screen.getByTestId('bar-Estimated Range')).toHaveAttribute('data-value', '0')

    // And the visualisation receives 0 (a valid number), not NaN.
    const viz = screen.getByTestId('car-viz')
    expect(viz).toHaveAttribute('data-battery', '0')
    expect(viz).toHaveAttribute('data-speed', '0')

    // No 'NaN' string leaks into any rendered attribute.
    expect(document.body.innerHTML).not.toContain('NaN')
  })
})
