// TelemetryPanels tests.
//
// The target module (TelemetryPanels.tsx) is the public surface for the
// vehicle live-telemetry UI; it re-exports two components which this suite
// imports through that barrel so the re-export contract is exercised:
//
//   1. TelemetryGrid — the compact six-tile "at a glance" summary. Covered:
//      - all six tiles render with their labels
//      - battery colour thresholds (>50 emerald / >20 amber / else rose)
//      - speed sub-label branch (Driving vs Parked)
//      - inside/outside temperature delegation to useUnits().formatTemperature
//      - odometer distance delegation WITH the { precision: 0 } option
//      - charger tile: charging (kW + "Full in Xh") vs not-charging branches
//      - sentry tile: Active vs Off + semantic colour
//      - a11y: every decorative InfoTile icon is aria-hidden
//
//   2. LiveTelemetryPanels — the composition of seven detail panels. Covered:
//      - the "Live Telemetry" section header + all seven panel headings
//        render (verifies each child is wired in)
//      - security data + remoteStartEnabled are forwarded to SecurityPanel
//      - the SecurityPanel hasData OR-branch (remoteStartEnabled alone)
//      - sseConnected toggles the VehicleState "Live" badge; live flags read
//      - tire pressures are converted (Pa→kPa) + formatted, status computed
//      - charging telemetry state/level surface in EnergyChargingPanel
//      - media + navigation destination surface in MediaNavigationPanel
//      - every data source shows an explicit placeholder when null (no blank
//        panel) while the panel shell/heading still renders
//
// Network is never touched: react-i18next echoes the English fallback,
// @/hooks/useUnits is stubbed with deterministic formatters, and
// @/components/motion is a passthrough (framer-motion reaches for matchMedia
// via useMotionPreference — the sibling drive-detail convention).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import type {
  VehicleState,
  MotorSnapshot,
  ClimateSnapshot,
  SecurityEvent,
  TirePressureSnapshot,
  ChargingTelemetry,
  MediaSnapshot,
  LocationSnapshot,
} from '@/api/types'
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat'

// ── Deterministic unit formatters. Distance renders "<n> km", speed
// "<n> km/h", temperature/pressure "<n>°C"/"<n> bar" for finite numbers and
// an em dash for nullish input (mirroring the lib's empty-display contract).
// Each is a spy so delegation (raw SI value + option forwarding) is assertable.
const { fmt } = vi.hoisted(() => ({
  fmt: {
    formatDistance: vi.fn((v?: number | null) => (typeof v === 'number' ? `${v} km` : '—')),
    formatSpeed: vi.fn((v?: number | null) => (typeof v === 'number' ? `${v} km/h` : '—')),
    formatTemperature: vi.fn((v?: number | null) => (typeof v === 'number' ? `${v}\u00B0C` : '—')),
    formatPressure: vi.fn((v?: number | null) => (typeof v === 'number' ? `${v} bar` : '—')),
    formatEnergy: vi.fn((v?: number | null) => (typeof v === 'number' ? `${v} kWh` : '—')),
    formatDuration: vi.fn((v?: number | null) => (typeof v === 'number' ? `${v} h` : '—')),
    formatPower: vi.fn((v?: number | null) => (typeof v === 'number' ? `${v} kW` : '—')),
  },
}))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '\u00B0C',
      pressure: 'bar',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
    ...fmt,
  }),
}))

// FadeIn / StaggerContainer / StaggerItem wrap children in framer-motion
// elements that reach for matchMedia via useMotionPreference; passthroughs
// keep the DOM flat and the assertions focused on our own output.
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
  StaggerContainer: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  StaggerItem: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

// i18n stub: return the default-fallback string (with {{token}} interpolation)
// so assertions read on stable English copy independent of the en.json shape
// (same convention the sibling ClimatePanel / PowertrainPanel tests use).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined
        const opts =
          typeof fallbackOrOpts === 'object' && fallbackOrOpts !== null
            ? (fallbackOrOpts as Record<string, unknown>)
            : (maybeOpts as Record<string, unknown> | undefined)
        if (opts && typeof opts.defaultValue === 'string') return opts.defaultValue as string
        let out = fallback ?? key
        if (opts) {
          for (const [k, v] of Object.entries(opts)) {
            out = out.replace(`{{${k}}}`, String(v))
          }
        }
        return out
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { TelemetryGrid, LiveTelemetryPanels } from './TelemetryPanels'

// ── Factories ────────────────────────────────────────────────────────────
function makeState(o: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 75,
    rated_range: 300,
    ideal_range: 320,
    odometer: 12000,
    inside_temp: 21,
    outside_temp: 5,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '2024.1',
    ...o,
  }
}

function makeMotor(o: Partial<MotorSnapshot> = {}): MotorSnapshot {
  return {
    ts: '2026-07-05T10:00:00Z',
    created_at: '2026-07-05T10:00:00Z',
    vehicle_id: 1,
    torque_nm_front: 100,
    torque_nm_rear: 90,
    di_torque: null,
    motor_rpm_front: 1000,
    motor_rpm_rear: 1000,
    motor_temp_c_front: 40,
    motor_temp_c_rear: 45,
    inverter_temp_c: 35,
    inverter_temp_rear: null,
    heatsink_temp_front: null,
    heatsink_temp_rear: null,
    motor_current_front: null,
    motor_current_rear: null,
    state_front: null,
    state_rear: null,
    shift_state: 'D',
    vbat_front: null,
    vbat_rear: null,
    power_kw: 120,
    regen_kw: 0,
    source: 'signal_log',
    ...o,
  }
}

function makeClimate(o: Partial<ClimateSnapshot> = {}): ClimateSnapshot {
  return {
    vehicle_id: 1,
    ts: '2026-07-05T10:00:00Z',
    inside_temp_c: 21.5,
    outside_temp_c: 3.3,
    driver_setpoint_c: 20,
    passenger_setpoint_c: 18,
    hvac_state: 'Heating',
    defrost_mode: 'Off',
    is_climate_on: true,
    is_preconditioning: false,
    fan_status: 4,
    seat_heater_left: null,
    seat_heater_right: null,
    seat_heater_rear_left: null,
    seat_heater_rear_right: null,
    steering_wheel_heater: null,
    cabin_overheat_protection: null,
    source: 'signal_log',
    ...o,
  }
}

function makeSecurity(o: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    vehicle_id: 1,
    ts: '2026-07-05T10:00:00Z',
    event_type: 'update',
    doors_open: null,
    windows_open: null,
    locked: true,
    sentry_mode: false,
    user_present: false,
    detail: null,
    source: 'signal_log',
    created_at: '2026-07-05T10:00:00Z',
    ...o,
  }
}

function makeTire(o: Partial<TirePressureSnapshot> = {}): TirePressureSnapshot {
  return {
    id: 1,
    vehicle_id: 1,
    // 290 000 Pa ≈ 42 psi — inside the "all normal" band (241 300–310 300 Pa).
    front_left: 290_000,
    front_right: 290_000,
    rear_left: 290_000,
    rear_right: 290_000,
    created_at: '2026-07-05T10:00:00Z',
    ...o,
  }
}

function makeCharging(o: Partial<ChargingTelemetry> = {}): ChargingTelemetry {
  return {
    vehicle_id: 1,
    ts: '2026-07-05T10:00:00Z',
    session_id: null,
    battery_level: null,
    battery_range_mi: null,
    charging_state: null,
    charger_voltage: null,
    charger_actual_current: null,
    charger_power_w: null,
    charger_phases: null,
    charge_energy_added_wh: null,
    range_added_meters: null,
    range_added_meters_per_hour: null,
    charger_pilot_current: null,
    scheduled_charging_at: null,
    source: 'signal_log',
    ...o,
  }
}

function makeMedia(o: Partial<MediaSnapshot> = {}): MediaSnapshot {
  return {
    id: 1,
    vehicle_id: 1,
    created_at: '2026-07-05T10:00:00Z',
    ...o,
  }
}

function makeLocation(o: Partial<LocationSnapshot> = {}): LocationSnapshot {
  return {
    id: 1,
    created_at: '2026-07-05T10:00:00Z',
    ...o,
  }
}

type LiveProps = ComponentProps<typeof LiveTelemetryPanels>
function makeLiveProps(o: Partial<LiveProps> = {}): LiveProps {
  return {
    motorData: makeMotor(),
    climateData: makeClimate(),
    securityData: makeSecurity(),
    tireData: makeTire(),
    chargingTelemetry: makeCharging(),
    mediaData: makeMedia(),
    locationData: makeLocation(),
    live: {},
    sseConnected: false,
    remoteStartEnabled: null,
    ...o,
  }
}

/** The GlassPanel wrapping a section, resolved from its heading. */
function panelFor(nameRe: RegExp): HTMLElement {
  const heading = screen.getByRole('heading', { name: nameRe })
  return heading.parentElement as HTMLElement
}

beforeEach(() => {
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
  Object.values(fmt).forEach((spy) => spy.mockClear())
})

afterEach(() => {
  cleanup()
})

// ═══════════════════════════ TelemetryGrid ════════════════════════════════
describe('TelemetryGrid — tiles', () => {
  it('renders all six labelled tiles and the battery percentage', () => {
    render(<TelemetryGrid state={makeState({ battery_level: 75 })} />)

    for (const label of ['Battery', 'Speed', 'Inside', 'Odometer', 'Charger', 'Sentry']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('75%')).toBeInTheDocument()
    // Battery sub delegates the rated range to formatDistance.
    expect(fmt.formatDistance).toHaveBeenCalledWith(300)
    expect(screen.getByText(/300 km\s+range/)).toBeInTheDocument()
  })
})

describe('TelemetryGrid — battery colour thresholds', () => {
  it('paints a high charge emerald', () => {
    render(<TelemetryGrid state={makeState({ battery_level: 80 })} />)
    expect(screen.getByText('80%')).toHaveClass('text-emerald-300')
  })

  it('paints a mid charge amber', () => {
    render(<TelemetryGrid state={makeState({ battery_level: 35 })} />)
    expect(screen.getByText('35%')).toHaveClass('text-amber-300')
  })

  it('paints a low charge rose', () => {
    render(<TelemetryGrid state={makeState({ battery_level: 10 })} />)
    expect(screen.getByText('10%')).toHaveClass('text-rose-300')
  })
})

describe('TelemetryGrid — speed tile', () => {
  it('labels a moving vehicle Driving and delegates the raw speed', () => {
    render(<TelemetryGrid state={makeState({ speed: 60 })} />)

    expect(fmt.formatSpeed).toHaveBeenCalledWith(60)
    expect(screen.getByText('60 km/h')).toBeInTheDocument()
    expect(screen.getByText('Driving')).toBeInTheDocument()
  })

  it('labels a stationary vehicle Parked', () => {
    render(<TelemetryGrid state={makeState({ speed: 0 })} />)
    expect(screen.getByText('Parked')).toBeInTheDocument()
    expect(screen.queryByText('Driving')).toBeNull()
  })
})

describe('TelemetryGrid — temperature + odometer delegation', () => {
  it('forwards the raw inside/outside °C to formatTemperature', () => {
    render(<TelemetryGrid state={makeState({ inside_temp: 22, outside_temp: 4 })} />)

    expect(fmt.formatTemperature).toHaveBeenCalledWith(22)
    expect(fmt.formatTemperature).toHaveBeenCalledWith(4)
    expect(screen.getByText('22\u00B0C')).toBeInTheDocument()
    expect(screen.getByText(/Outside:\s*4\u00B0C/)).toBeInTheDocument()
  })

  it('formats the odometer with the precision-0 option', () => {
    render(<TelemetryGrid state={makeState({ odometer: 12345 })} />)
    expect(fmt.formatDistance).toHaveBeenCalledWith(12345, { precision: 0 })
    expect(screen.getByText('12345 km')).toBeInTheDocument()
  })
})

describe('TelemetryGrid — charger tile', () => {
  it('shows power + time-to-full while charging', () => {
    render(
      <TelemetryGrid
        state={makeState({ is_charging: true, charger_power: 11, time_to_full_charge: 2 })}
      />,
    )

    const value = screen.getByText('11 kW')
    expect(value).toBeInTheDocument()
    expect(value).toHaveClass('text-emerald-300')
    expect(screen.getByText('Full in 2.0h')).toBeInTheDocument()
  })

  it('shows "Not Charging" and no time-to-full when idle', () => {
    render(<TelemetryGrid state={makeState({ is_charging: false })} />)

    expect(screen.getByText('Not Charging')).toHaveClass('text-[var(--text-muted)]')
    expect(screen.queryByText(/Full in/)).toBeNull()
  })
})

describe('TelemetryGrid — sentry tile + a11y', () => {
  it('renders an active sentry in rose and an inactive one muted', () => {
    const { rerender } = render(<TelemetryGrid state={makeState({ sentry_mode: true })} />)
    expect(screen.getByText('Active')).toHaveClass('text-rose-300')

    rerender(<TelemetryGrid state={makeState({ sentry_mode: false })} />)
    expect(screen.getByText('Off')).toHaveClass('text-[var(--text-muted)]')
  })

  it('marks every decorative tile icon aria-hidden', () => {
    const { container } = render(<TelemetryGrid state={makeState()} />)

    const svgs = container.querySelectorAll('svg')
    expect(svgs).toHaveLength(6)
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'))
  })
})

// ═════════════════════════ LiveTelemetryPanels ════════════════════════════
describe('LiveTelemetryPanels — composition', () => {
  it('renders the section header and every child panel heading', () => {
    render(<LiveTelemetryPanels {...makeLiveProps()} />)

    expect(screen.getByRole('heading', { name: /Live Telemetry/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Powertrain/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Climate/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Security/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Vehicle State/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Tire Pressure/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Energy & Charging/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Media & Navigation/ })).toBeInTheDocument()
  })
})

describe('LiveTelemetryPanels — security delegation', () => {
  it('forwards securityData + remoteStartEnabled into SecurityPanel', () => {
    render(
      <LiveTelemetryPanels
        {...makeLiveProps({
          securityData: makeSecurity({ locked: true, sentry_mode: true }),
          remoteStartEnabled: true,
        })}
      />,
    )

    const panel = within(panelFor(/Security/))
    expect(panel.getByText('Locked')).toBeInTheDocument()
    expect(panel.getByText('Enabled')).toBeInTheDocument()
  })

  it('keeps SecurityPanel populated when only remoteStartEnabled is known', () => {
    render(
      <LiveTelemetryPanels {...makeLiveProps({ securityData: null, remoteStartEnabled: false })} />,
    )

    expect(screen.queryByText('No security data available')).toBeNull()
    expect(within(panelFor(/Security/)).getByText('Disabled')).toBeInTheDocument()
  })
})

describe('LiveTelemetryPanels — vehicle state + sse', () => {
  it('shows the Live badge and reads live flags when connected', () => {
    render(
      <LiveTelemetryPanels
        {...makeLiveProps({ sseConnected: true, live: { lightsHighBeams: true } })}
      />,
    )

    const panel = within(panelFor(/Vehicle State/))
    expect(panel.getByText('Live')).toBeInTheDocument()
    expect(panel.getByText('On')).toBeInTheDocument()
  })

  it('hides the Live badge when disconnected', () => {
    render(<LiveTelemetryPanels {...makeLiveProps({ sseConnected: false })} />)
    expect(within(panelFor(/Vehicle State/)).queryByText('Live')).toBeNull()
  })
})

describe('LiveTelemetryPanels — tire + charging + media', () => {
  it('converts Pa→kPa, formats each tire, and reports all-normal', () => {
    render(<LiveTelemetryPanels {...makeLiveProps({ tireData: makeTire() })} />)

    const panel = within(panelFor(/Tire Pressure/))
    // paToKpa(290000) === 290 → formatPressure(290) → "290 bar", one per tire.
    expect(fmt.formatPressure).toHaveBeenCalledWith(290)
    expect(panel.getAllByText('290 bar')).toHaveLength(4)
    expect(panel.getByText(/All Normal/)).toBeInTheDocument()
  })

  it('surfaces charging state + battery level in EnergyChargingPanel', () => {
    render(
      <LiveTelemetryPanels
        {...makeLiveProps({
          chargingTelemetry: makeCharging({
            charging_state: 'Charging',
            battery_level: 66,
            charger_voltage: 240,
          }),
        })}
      />,
    )

    const panel = within(panelFor(/Energy & Charging/))
    expect(panel.getByText('Charging')).toBeInTheDocument()
    expect(panel.getByText('66.00%')).toBeInTheDocument()
    expect(panel.getByText('240.00')).toBeInTheDocument()
  })

  it('renders now-playing and the navigation destination', () => {
    render(
      <LiveTelemetryPanels
        {...makeLiveProps({
          mediaData: makeMedia({ now_playing_title: 'Song X', now_playing_artist: 'Artist Y' }),
          locationData: makeLocation({
            destination_name: 'Home Base',
            miles_to_arrival: 5000,
            minutes_to_arrival: 12,
          }),
        })}
      />,
    )

    const panel = within(panelFor(/Media & Navigation/))
    expect(panel.getByText('Song X')).toBeInTheDocument()
    expect(panel.getByText('Artist Y')).toBeInTheDocument()
    expect(panel.getByText('Home Base')).toBeInTheDocument()
    // 5000 m → convertDistanceFromSI(5000,'km') === 5 → "5.00 km".
    expect(panel.getByText('5.00 km')).toBeInTheDocument()
    expect(panel.getByText('12 min')).toBeInTheDocument()
  })
})

describe('LiveTelemetryPanels — empty states', () => {
  it('shows an explicit placeholder for every null data source without blanking a panel', () => {
    render(
      <LiveTelemetryPanels
        {...makeLiveProps({
          motorData: null,
          climateData: null,
          securityData: null,
          tireData: null,
          chargingTelemetry: null,
          mediaData: null,
          locationData: null,
          remoteStartEnabled: null,
        })}
      />,
    )

    expect(screen.getByText('No motor data available')).toBeInTheDocument()
    expect(screen.getByText('No climate data available')).toBeInTheDocument()
    expect(screen.getByText('No security data available')).toBeInTheDocument()
    expect(screen.getByText('No tire pressure data available')).toBeInTheDocument()
    expect(screen.getByText('No charging telemetry available')).toBeInTheDocument()
    expect(screen.getByText('No media data')).toBeInTheDocument()
    expect(screen.getByText('No location data')).toBeInTheDocument()

    // Panels never disappear — their shells/headings still render.
    expect(screen.getByRole('heading', { name: /Powertrain/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Vehicle State/ })).toBeInTheDocument()
  })
})
