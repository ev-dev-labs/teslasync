// BatteryRangePanel unit tests.
//
// Coverage (the panel's single export — `BatteryRangePanel`):
//   1. Battery gauge: renders the level / unit / label, drives the shared
//      RadialGauge colour through `batteryColor`'s three bands (green > 60,
//      amber 25–60, red <= 25), and — the bug this suite locks in —
//      null-safes an undefined `battery_level` to 0 so the gauge never emits
//      `strokeDashoffset={NaN}` nor mislabels an unknown battery as red-critical.
//   2. Range metrics: rated + ideal range delegate to `useUnits().formatDistance`
//      with the raw SI value and `{ precision: 0 }`, surface the formatted
//      output, and fall back to an em dash when a range is missing.
//   3. Charging state: shows the per-hour charge rate while charging, the
//      "Not Charging" copy when idle (and skips the charge-rate format call),
//      and only renders the time-to-full subtitle when charging AND an ETA > 0
//      exists.
//   4. a11y: every decorative lucide icon is marked aria-hidden.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { VehicleState } from '@/api/types'

// Deterministic distance formatter so assertions don't depend on the real
// SI-conversion lib or the settings context. Returns `<n> km` for a finite
// number and an em dash for nullish/non-finite input (mirroring the lib's own
// empty-display contract), and records its args for delegation assertions.
const { mockFormatDistance } = vi.hoisted(() => ({
  mockFormatDistance: vi.fn((v: number | null | undefined) =>
    typeof v === 'number' && Number.isFinite(v) ? `${v} km` : '—',
  ),
}))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDistance: mockFormatDistance }),
}))

// i18n stub: return the default-fallback string so the tests assert on stable
// English copy independent of the en.json shape (same convention the sibling
// ClimatePanel / PowertrainPanel tests use).
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

import { BatteryRangePanel } from './BatteryRangePanel'

function makeState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    battery_level: 72,
    rated_range: 500,
    ideal_range: 480,
    odometer: 12_000,
    inside_temp: 21,
    outside_temp: 15,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 48,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '2024.1',
    ...overrides,
  }
}

// The RadialGauge renders two <circle>s: [0] is the static track
// (stroke="currentColor"), [1] is the value arc whose `stroke` is the
// battery colour and whose `stroke-dashoffset` encodes the level.
function progressCircle(container: HTMLElement): SVGCircleElement {
  const circles = container.querySelectorAll('circle')
  return circles[1] as SVGCircleElement
}

beforeEach(() => {
  mockFormatDistance.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('BatteryRangePanel — battery gauge', () => {
  it('renders the battery level, percent unit, and label', () => {
    render(<BatteryRangePanel state={makeState({ battery_level: 72 })} />)

    expect(screen.getByText('72')).toBeInTheDocument()
    expect(screen.getByText('%')).toBeInTheDocument()
    expect(screen.getByText('Battery')).toBeInTheDocument()
  })

  it('colours the gauge emerald above the 60% band', () => {
    const { container } = render(<BatteryRangePanel state={makeState({ battery_level: 72 })} />)
    expect(progressCircle(container)).toHaveAttribute('stroke', '#10b981')
  })

  it('colours the gauge amber inside the 25–60% band', () => {
    const { container } = render(<BatteryRangePanel state={makeState({ battery_level: 40 })} />)
    expect(progressCircle(container)).toHaveAttribute('stroke', '#f59e0b')
  })

  it('colours the gauge red at or below the 25% band', () => {
    const { container } = render(<BatteryRangePanel state={makeState({ battery_level: 10 })} />)
    expect(progressCircle(container)).toHaveAttribute('stroke', '#ef4444')
  })

  it('null-safes an undefined battery level to 0 without emitting NaN geometry', () => {
    const { container } = render(
      <BatteryRangePanel state={makeState({ battery_level: undefined })} />,
    )

    // Value falls back to 0 (not NaN → "0" via the gauge formatter)...
    expect(screen.getByText('0')).toBeInTheDocument()
    // ...an unknown battery is treated as the critical-low colour...
    expect(progressCircle(container)).toHaveAttribute('stroke', '#ef4444')
    // ...and crucially the arc geometry stays a finite number (the fix:
    // an undefined level previously produced strokeDashoffset={NaN}).
    const offset = progressCircle(container).getAttribute('stroke-dashoffset')
    expect(offset).not.toBeNull()
    expect(Number.isNaN(Number(offset))).toBe(false)
  })
})

describe('BatteryRangePanel — range metrics', () => {
  it('delegates rated + ideal range to formatDistance at precision 0 and renders them', () => {
    render(<BatteryRangePanel state={makeState({ rated_range: 500, ideal_range: 480 })} />)

    expect(mockFormatDistance).toHaveBeenCalledWith(500, { precision: 0 })
    expect(mockFormatDistance).toHaveBeenCalledWith(480, { precision: 0 })
    expect(screen.getByText('Rated Range')).toBeInTheDocument()
    expect(screen.getByText('Ideal Range')).toBeInTheDocument()
    expect(screen.getByText('500 km')).toBeInTheDocument()
    expect(screen.getByText('480 km')).toBeInTheDocument()
  })

  it('renders an em dash when a range value is missing', () => {
    render(<BatteryRangePanel state={makeState({ rated_range: undefined })} />)

    expect(mockFormatDistance).toHaveBeenCalledWith(undefined, { precision: 0 })
    // The Rated Range card body falls back to the formatter's em dash.
    expect(screen.getByText('Rated Range').closest('div')).toHaveTextContent('—')
  })
})

describe('BatteryRangePanel — charging state', () => {
  it('shows the per-hour charge rate while charging', () => {
    render(<BatteryRangePanel state={makeState({ is_charging: true, charge_rate: 48 })} />)

    expect(mockFormatDistance).toHaveBeenCalledWith(48)
    expect(screen.getByText('48 km/h')).toBeInTheDocument()
  })

  it('shows "Not Charging" when idle and never formats the charge rate', () => {
    render(<BatteryRangePanel state={makeState({ is_charging: false, charge_rate: 48 })} />)

    expect(screen.getByText('Not Charging')).toBeInTheDocument()
    expect(screen.queryByText('48 km/h')).toBeNull()
    expect(mockFormatDistance).not.toHaveBeenCalledWith(48)
  })

  it('surfaces the time-to-full subtitle while charging with an ETA', () => {
    render(
      <BatteryRangePanel
        state={makeState({ is_charging: true, time_to_full_charge: 1.5 })}
      />,
    )

    expect(screen.getByText('Full in 1.5h')).toBeInTheDocument()
  })

  it('omits the subtitle when charging but the ETA is zero', () => {
    render(
      <BatteryRangePanel
        state={makeState({ is_charging: true, time_to_full_charge: 0 })}
      />,
    )

    expect(screen.queryByText(/Full in/)).toBeNull()
  })

  it('omits the subtitle when idle even if an ETA is present', () => {
    render(
      <BatteryRangePanel
        state={makeState({ is_charging: false, time_to_full_charge: 2 })}
      />,
    )

    expect(screen.queryByText(/Full in/)).toBeNull()
    expect(screen.getByText('Not Charging')).toBeInTheDocument()
  })
})

describe('BatteryRangePanel — accessibility', () => {
  it('marks the three decorative lucide icons as aria-hidden', () => {
    const { container } = render(<BatteryRangePanel state={makeState()} />)

    // Navigation + MapPin + BatteryCharging are decorative; the gauge's own
    // <svg> is intentionally NOT hidden (it carries the visible readout).
    const hidden = container.querySelectorAll('svg[aria-hidden="true"]')
    expect(hidden).toHaveLength(3)
  })
})
