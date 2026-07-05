// PowertrainPanel unit tests.
//
// Coverage (the panel's single export — `PowertrainPanel`):
//   1. Empty state: renders the heading + a role="status" placeholder when
//      `motorData` is null OR undefined, draws no power meter, and never
//      touches the temperature formatter.
//   2. Shift-state badge: each gear (D/R/N) maps to its semantic colour, an
//      unrecognised gear (P) falls to the muted style, and a null gear shows
//      the localized "Unknown" fallback.
//   3. Power meter: exposes an accessible role="meter" whose aria-valuenow is
//      clamped into [-300, 300] while aria-valuetext keeps the raw reading,
//      across positive / negative / >max / null power.
//   4. RPM + torque cards: front/rear values format via the number lib and
//      fall back to an em dash when an axle is null.
//   5. Temperatures: peak motor temp delegates the raw °C max to
//      `useUnits().formatTemperature`, flags >80 °C hot, and shows an em dash
//      when neither axle reports; inverter temp delegates its raw value.
//   6. Regen: renders kW when present, an em dash (no unit) when null.
//   7. a11y: every decorative icon + the power scale ticks are aria-hidden.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { MotorSnapshot } from '@/api/types'

// Deterministic temperature formatter: `<n>°C` for a finite number, em dash
// for nullish input (mirroring the lib's empty-display contract). Records
// its args so we can assert the panel forwards the raw SI (°C) value.
const { mockFormatTemperature } = vi.hoisted(() => ({
  mockFormatTemperature: vi.fn((v: number | null | undefined) =>
    typeof v === 'number' ? `${v}°C` : '—',
  ),
}))

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatTemperature: mockFormatTemperature }),
}))

// i18n stub: return the default-fallback string so assertions read on stable
// English copy independent of the en.json shape (same convention the sibling
// ClimatePanel tests use).
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

import { PowertrainPanel } from './PowertrainPanel'

function makeMotor(overrides: Partial<MotorSnapshot> = {}): MotorSnapshot {
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
    ...overrides,
  }
}

beforeEach(() => {
  mockFormatTemperature.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('PowertrainPanel — empty state', () => {
  it('renders the heading + status placeholder and no meter when data is null', () => {
    render(<PowertrainPanel motorData={null} />)

    expect(screen.getByRole('heading', { name: /Powertrain/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No motor data available')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
    expect(mockFormatTemperature).not.toHaveBeenCalled()
  })

  it('renders the same placeholder when data is undefined', () => {
    render(<PowertrainPanel motorData={undefined} />)

    expect(screen.getByText('No motor data available')).toBeInTheDocument()
    expect(screen.queryByRole('meter')).toBeNull()
    expect(mockFormatTemperature).not.toHaveBeenCalled()
  })
})

describe('PowertrainPanel — shift state badge', () => {
  it('renders D in the drive (green) style', () => {
    render(<PowertrainPanel motorData={makeMotor({ shift_state: 'D' })} />)
    const badge = screen.getByText('D')
    expect(badge).toHaveClass('text-green-400', 'bg-green-500/10', 'border-green-500/30')
  })

  it('renders R in the reverse (red) style', () => {
    render(<PowertrainPanel motorData={makeMotor({ shift_state: 'R' })} />)
    expect(screen.getByText('R')).toHaveClass('text-red-400', 'bg-red-500/10')
  })

  it('renders N in the neutral (amber) style', () => {
    render(<PowertrainPanel motorData={makeMotor({ shift_state: 'N' })} />)
    expect(screen.getByText('N')).toHaveClass('text-amber-400', 'bg-amber-500/10')
  })

  it('renders an unrecognised gear (P) in the muted fallback style', () => {
    render(<PowertrainPanel motorData={makeMotor({ shift_state: 'P' })} />)
    expect(screen.getByText('P')).toHaveClass('bg-gray-500/10', 'border-gray-500/30')
  })

  it('falls back to the localized Unknown label when shift_state is null', () => {
    render(<PowertrainPanel motorData={makeMotor({ shift_state: null })} />)
    const badge = screen.getByText('Unknown')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveClass('bg-gray-500/10')
  })
})

describe('PowertrainPanel — power meter', () => {
  it('exposes an accessible meter for positive (drive) power', () => {
    render(<PowertrainPanel motorData={makeMotor({ power_kw: 150 })} />)

    const meter = screen.getByRole('meter')
    expect(meter).toHaveAttribute('aria-label', 'Power')
    expect(meter).toHaveAttribute('aria-valuemin', '-300')
    expect(meter).toHaveAttribute('aria-valuemax', '300')
    expect(meter).toHaveAttribute('aria-valuenow', '150')
    expect(meter).toHaveAttribute('aria-valuetext', '150.00 kW')
    expect(screen.getByText('150.00 kW')).toBeInTheDocument()
  })

  it('reports negative (regen) power without clamping within range', () => {
    render(<PowertrainPanel motorData={makeMotor({ power_kw: -80 })} />)

    const meter = screen.getByRole('meter')
    expect(meter).toHaveAttribute('aria-valuenow', '-80')
    expect(meter).toHaveAttribute('aria-valuetext', '-80.00 kW')
  })

  it('clamps aria-valuenow to the max but keeps the raw reading in valuetext', () => {
    render(<PowertrainPanel motorData={makeMotor({ power_kw: 600 })} />)

    const meter = screen.getByRole('meter')
    expect(meter).toHaveAttribute('aria-valuenow', '300')
    expect(meter).toHaveAttribute('aria-valuetext', '600.00 kW')
  })

  it('renders no meter and an em dash when power is null', () => {
    render(<PowertrainPanel motorData={makeMotor({ power_kw: null })} />)

    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.getByText(/—\s*kW/)).toBeInTheDocument()
  })
})

describe('PowertrainPanel — motor RPM', () => {
  it('renders front + rear RPM with locale-grouped integers', () => {
    render(<PowertrainPanel motorData={makeMotor({ motor_rpm_front: 2400, motor_rpm_rear: -120 })} />)

    expect(screen.getByText('Front RPM')).toBeInTheDocument()
    expect(screen.getByText('Rear RPM')).toBeInTheDocument()
    expect(screen.getByText('2,400')).toBeInTheDocument()
    expect(screen.getByText('-120')).toBeInTheDocument()
  })

  it('renders an em dash for a null RPM axle while the other still formats', () => {
    render(<PowertrainPanel motorData={makeMotor({ motor_rpm_front: null, motor_rpm_rear: 900 })} />)

    expect(screen.getByText('Front RPM').closest('div')).toHaveTextContent('—')
    expect(screen.getByText('900')).toBeInTheDocument()
  })
})

describe('PowertrainPanel — torque split', () => {
  it('renders front + rear torque in Nm', () => {
    render(<PowertrainPanel motorData={makeMotor({ torque_nm_front: 320.5, torque_nm_rear: 280 })} />)

    expect(screen.getByText('Front Torque')).toBeInTheDocument()
    expect(screen.getByText('Rear Torque')).toBeInTheDocument()
    expect(screen.getByText('320.50')).toBeInTheDocument()
    expect(screen.getByText('280.00')).toBeInTheDocument()
    expect(screen.getAllByText('Nm')).toHaveLength(2)
  })

  it('renders an em dash for a null torque axle', () => {
    render(<PowertrainPanel motorData={makeMotor({ torque_nm_front: null })} />)
    expect(screen.getByText('Front Torque').closest('div')).toHaveTextContent('—')
  })
})

describe('PowertrainPanel — motor temperature', () => {
  it('delegates the peak temp to formatTemperature with the raw °C max and flags it hot', () => {
    render(
      <PowertrainPanel
        motorData={makeMotor({ motor_temp_c_front: 45, motor_temp_c_rear: 85, inverter_temp_c: 30 })}
      />,
    )

    expect(mockFormatTemperature).toHaveBeenCalledWith(85)
    const peak = screen.getByText('85°C')
    expect(peak).toHaveClass('text-red-400')
  })

  it('renders the peak temp in the neutral colour below the warning threshold', () => {
    render(
      <PowertrainPanel
        motorData={makeMotor({ motor_temp_c_front: 40, motor_temp_c_rear: 50, inverter_temp_c: 30 })}
      />,
    )

    const peak = screen.getByText('50°C')
    expect(peak).not.toHaveClass('text-red-400')
    expect(peak).toHaveClass('text-[var(--text-primary)]')
  })

  it('shows an em dash and skips the formatter when neither axle reports a motor temp', () => {
    render(
      <PowertrainPanel
        motorData={makeMotor({ motor_temp_c_front: null, motor_temp_c_rear: null, inverter_temp_c: 30 })}
      />,
    )

    expect(screen.getByText('Motor Temp (peak)').parentElement).toHaveTextContent('—')
    // Peak formatter is bypassed (only inverter's 30 °C reaches it).
    expect(mockFormatTemperature).not.toHaveBeenCalledWith(-Infinity)
  })
})

describe('PowertrainPanel — inverter temperature', () => {
  it('delegates the inverter temp to formatTemperature with the raw °C value', () => {
    render(<PowertrainPanel motorData={makeMotor({ inverter_temp_c: 42 })} />)

    expect(mockFormatTemperature).toHaveBeenCalledWith(42)
    expect(screen.getByText('Inverter Temp').parentElement).toHaveTextContent('42°C')
  })

  it('renders the formatter fallback when inverter temp is null', () => {
    render(
      <PowertrainPanel
        motorData={makeMotor({ inverter_temp_c: null, motor_temp_c_front: null, motor_temp_c_rear: null })}
      />,
    )

    expect(mockFormatTemperature).toHaveBeenCalledWith(null)
    expect(screen.getByText('Inverter Temp').parentElement).toHaveTextContent('—')
  })
})

describe('PowertrainPanel — regen', () => {
  it('renders regen power in kW', () => {
    render(<PowertrainPanel motorData={makeMotor({ regen_kw: 25 })} />)
    expect(screen.getByText('Regen').parentElement).toHaveTextContent('25.00 kW')
  })

  it('renders an em dash with no unit when regen is null', () => {
    render(<PowertrainPanel motorData={makeMotor({ regen_kw: null, power_kw: 10 })} />)

    const regenRow = screen.getByText('Regen').parentElement
    expect(regenRow).toHaveTextContent('—')
    expect(regenRow).not.toHaveTextContent('kW')
  })
})

describe('PowertrainPanel — accessibility', () => {
  it('marks every decorative icon as aria-hidden', () => {
    const { container } = render(<PowertrainPanel motorData={makeMotor()} />)

    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBeGreaterThanOrEqual(2)
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'))
  })

  it('hides the decorative power scale ticks from assistive tech', () => {
    render(<PowertrainPanel motorData={makeMotor({ power_kw: 100 })} />)

    const tick = screen.getByText('+300')
    expect(tick.parentElement).toHaveAttribute('aria-hidden', 'true')
  })
})
