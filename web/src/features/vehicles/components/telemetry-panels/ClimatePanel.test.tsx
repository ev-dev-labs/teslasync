// ClimatePanel unit tests.
//
// Coverage (the panel's single export — `ClimatePanel`):
//   1. Empty state: renders the shell + heading and a role="status"
//      placeholder when `climateData` is null OR undefined, calls no
//      formatter, and renders no fan meter.
//   2. Temperatures: cabin / outside metric cards + driver / passenger
//      setpoints delegate to `useUnits().formatTemperature` with the raw
//      SI (°C) values and surface the formatted output.
//   3. HVAC state: shows the raw state, and falls back to an em dash when
//      the value is null OR whitespace-only.
//   4. Fan speed: exposes an accessible role="meter" with clamped
//      aria-valuenow, raw aria-valuetext, and stable min/max/label —
//      including the >max clamp branch and the null → 0 branch.
//   5. Status badges: defrost (active mode / Off / null), climate (on/off),
//      and precondition (on/off) render the correct label + state text.
//   6. a11y: every decorative icon is aria-hidden.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ClimateSnapshot } from '@/api/types'

// Deterministic temperature formatter so assertions don't depend on the
// real SI-conversion lib or the settings context. Returns `<n>°C` for a
// finite number and an em dash for nullish input (mirroring the lib's own
// empty-display contract), and records its args for delegation assertions.
const { mockFormatTemperature } = vi.hoisted(() => ({
  mockFormatTemperature: vi.fn((v: number | null | undefined) =>
    typeof v === 'number' ? `${v}°C` : '—',
  ),
}))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatTemperature: mockFormatTemperature }),
}))

// i18n stub: return the default-fallback string so the tests assert on
// stable English copy independent of the en.json shape (mirrors the
// convention used by the sibling VehiclePhotoUpload tests).
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

import { ClimatePanel } from './ClimatePanel'

function makeClimate(overrides: Partial<ClimateSnapshot> = {}): ClimateSnapshot {
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
    ...overrides,
  }
}

beforeEach(() => {
  mockFormatTemperature.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('ClimatePanel — empty state', () => {
  it('renders the heading + status placeholder and no meter when data is null', () => {
    render(<ClimatePanel climateData={null} />)

    expect(screen.getByText('Climate')).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No climate data available')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
    expect(mockFormatTemperature).not.toHaveBeenCalled()
  })

  it('renders the same placeholder when data is undefined', () => {
    render(<ClimatePanel climateData={undefined} />)

    expect(screen.getByText('No climate data available')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
    expect(mockFormatTemperature).not.toHaveBeenCalled()
  })
})

describe('ClimatePanel — temperatures', () => {
  it('delegates cabin + outside temps to formatTemperature with raw °C values', () => {
    render(<ClimatePanel climateData={makeClimate({ inside_temp_c: 21.5, outside_temp_c: 3.3 })} />)

    expect(mockFormatTemperature).toHaveBeenCalledWith(21.5)
    expect(mockFormatTemperature).toHaveBeenCalledWith(3.3)
    expect(screen.getByText('Cabin')).toBeInTheDocument()
    expect(screen.getByText('Outside')).toBeInTheDocument()
    expect(screen.getByText('21.5°C')).toBeInTheDocument()
    expect(screen.getByText('3.3°C')).toBeInTheDocument()
  })

  it('delegates driver + passenger setpoints and renders the formatted values', () => {
    render(<ClimatePanel climateData={makeClimate({ driver_setpoint_c: 20, passenger_setpoint_c: 18 })} />)

    expect(mockFormatTemperature).toHaveBeenCalledWith(20)
    expect(mockFormatTemperature).toHaveBeenCalledWith(18)
    expect(screen.getByText('Driver Setpoint')).toBeInTheDocument()
    expect(screen.getByText('Passenger Setpoint')).toBeInTheDocument()
    expect(screen.getByText('20°C')).toBeInTheDocument()
    expect(screen.getByText('18°C')).toBeInTheDocument()
  })

  it('renders an em dash for a null cabin temperature', () => {
    render(<ClimatePanel climateData={makeClimate({ inside_temp_c: null })} />)

    expect(mockFormatTemperature).toHaveBeenCalledWith(null)
    // Cabin card is the first metric card — its value falls back to em dash.
    expect(screen.getByText('Cabin').closest('div')).toHaveTextContent('—')
  })
})

describe('ClimatePanel — HVAC state', () => {
  it('renders the raw HVAC state string', () => {
    render(<ClimatePanel climateData={makeClimate({ hvac_state: 'Heating' })} />)
    expect(screen.getByText('Heating')).toBeInTheDocument()
  })

  it('falls back to an em dash when HVAC state is null or whitespace-only', () => {
    const { rerender } = render(<ClimatePanel climateData={makeClimate({ hvac_state: null })} />)
    expect(screen.getByText('HVAC State').parentElement).toHaveTextContent('—')

    rerender(<ClimatePanel climateData={makeClimate({ hvac_state: '   ' })} />)
    expect(screen.getByText('HVAC State').parentElement).toHaveTextContent('—')
  })
})

describe('ClimatePanel — fan speed meter', () => {
  it('exposes an accessible meter with clamped value + raw value text', () => {
    render(<ClimatePanel climateData={makeClimate({ fan_status: 4 })} />)

    const meter = screen.getByRole('meter')
    expect(meter).toHaveAttribute('aria-label', 'Fan Speed')
    expect(meter).toHaveAttribute('aria-valuemin', '0')
    expect(meter).toHaveAttribute('aria-valuemax', '6')
    expect(meter).toHaveAttribute('aria-valuenow', '4')
    expect(meter).toHaveAttribute('aria-valuetext', '4')
    expect(screen.getByText('4')).toBeInTheDocument()
  })

  it('clamps aria-valuenow to the max but keeps the raw reading in valuetext', () => {
    render(<ClimatePanel climateData={makeClimate({ fan_status: 9 })} />)

    const meter = screen.getByRole('meter')
    expect(meter).toHaveAttribute('aria-valuenow', '6')
    expect(meter).toHaveAttribute('aria-valuetext', '9')
  })

  it('defaults a null fan_status to zero', () => {
    render(<ClimatePanel climateData={makeClimate({ fan_status: null })} />)

    const meter = screen.getByRole('meter')
    expect(meter).toHaveAttribute('aria-valuenow', '0')
    expect(meter).toHaveAttribute('aria-valuetext', '0')
  })
})

describe('ClimatePanel — status badges', () => {
  it('renders the active defrost mode, then Off for "Off" and null', () => {
    const { rerender } = render(<ClimatePanel climateData={makeClimate({ defrost_mode: 'Front' })} />)
    expect(screen.getByText(/Defrost/)).toHaveTextContent('Front')

    rerender(<ClimatePanel climateData={makeClimate({ defrost_mode: 'Off' })} />)
    expect(screen.getByText(/Defrost/)).toHaveTextContent('Off')

    rerender(<ClimatePanel climateData={makeClimate({ defrost_mode: null })} />)
    expect(screen.getByText(/Defrost/)).toHaveTextContent('Off')
  })

  it('reflects climate on/off state', () => {
    const { rerender } = render(<ClimatePanel climateData={makeClimate({ is_climate_on: true })} />)
    expect(screen.getByText(/Climate (On|Off)/)).toHaveTextContent('On')

    rerender(<ClimatePanel climateData={makeClimate({ is_climate_on: false })} />)
    expect(screen.getByText(/Climate (On|Off)/)).toHaveTextContent('Off')
  })

  it('reflects preconditioning on/off state', () => {
    const { rerender } = render(<ClimatePanel climateData={makeClimate({ is_preconditioning: true })} />)
    expect(screen.getByText(/Precondition/)).toHaveTextContent('On')

    rerender(<ClimatePanel climateData={makeClimate({ is_preconditioning: false })} />)
    expect(screen.getByText(/Precondition/)).toHaveTextContent('Off')
  })
})

describe('ClimatePanel — accessibility', () => {
  it('marks every decorative icon as aria-hidden', () => {
    const { container } = render(<ClimatePanel climateData={makeClimate()} />)

    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThanOrEqual(4)
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'))
  })
})
