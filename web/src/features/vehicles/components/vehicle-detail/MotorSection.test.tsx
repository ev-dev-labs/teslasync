// MotorSection unit tests.
//
// Coverage (the section's single export — `MotorSection`):
//   1. Empty state: renders the "Powertrain" heading + a role="status"
//      placeholder when `motorData` is null OR undefined, draws none of the
//      metric cards, and never touches the temperature formatter.
//   2. Shift-state card: surfaces the raw gear string and falls back to an em
//      dash when `shift_state` is null.
//   3. Pack-voltage card: prefers the rear-axle bus voltage, falls back to the
//      front, formats with a "V" unit, preserves a genuine 0 V reading (the
//      `??` vs `||` distinction), and shows an em dash when neither axle
//      reports.
//   4. Motor-current card: formats the front-axle current in amperes, keeps a
//      0 A reading, and em-dashes a null.
//   5. Torque split: front/rear torque format in Nm and each independently
//      falls back to an em dash.
//   6. Motor RPM: front/rear render as locale-grouped integers, preserve 0,
//      and em-dash a null axle.
//   7. Peak motor temperature: delegates the RAW (SI °C) higher-of-the-two-axle
//      value to `useUnits().formatTemperature` (display-boundary conversion is
//      the hook's job), works from a single populated axle without leaking the
//      -Infinity sentinel, and shows an em dash — skipping the formatter
//      entirely — when neither axle reports.
//   8. a11y: every decorative lucide icon (the Cog title glyph + all eight
//      metric-card glyphs) is marked aria-hidden.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { MotorSnapshot } from '@/api/types'
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat'

// Deterministic temperature formatter: `<n>°C` for a finite number, em dash
// for nullish input (mirroring the lib's empty-display contract). Records its
// args so we can assert the section forwards the RAW SI (°C) value and lets us
// prove the -Infinity sentinel never reaches it.
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
// PowertrainPanel / BatteryRangePanel tests use).
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

import { MotorSection } from './MotorSection'

// A fully-populated snapshot with deliberately DISTINCT numeric values so
// `getByText` stays unambiguous across the eight cards. Individual tests
// override the single field under exercise.
function makeMotor(overrides: Partial<MotorSnapshot> = {}): MotorSnapshot {
  return {
    ts: '2026-07-05T10:00:00Z',
    created_at: '2026-07-05T10:00:00Z',
    vehicle_id: 1,
    torque_nm_front: 320,
    torque_nm_rear: 280,
    di_torque: null,
    motor_rpm_front: 2400,
    motor_rpm_rear: 1800,
    motor_temp_c_front: 45,
    motor_temp_c_rear: 60,
    inverter_temp_c: 35,
    inverter_temp_rear: null,
    heatsink_temp_front: null,
    heatsink_temp_rear: null,
    motor_current_front: 250,
    motor_current_rear: null,
    state_front: null,
    state_rear: null,
    shift_state: 'D',
    vbat_front: 390,
    vbat_rear: 396,
    power_kw: 120,
    regen_kw: 0,
    source: 'signal_log',
    ...overrides,
  }
}

/** Scope to the label + value block of a single metric card. */
function card(label: string): HTMLElement {
  return screen.getByText(label).closest('div') as HTMLElement
}

beforeEach(() => {
  mockFormatTemperature.mockClear()
  // Hermetic number formatting: the real fmtNumber/fmtInt read module-global
  // precision/locale (normally set by useSettings). Pin them so assertions on
  // "396.00 V" / "2,400" are deterministic regardless of import-order effects.
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
})

afterEach(() => {
  cleanup()
})

describe('MotorSection — empty state', () => {
  it('renders the heading + status placeholder and no cards when data is null', () => {
    render(<MotorSection motorData={null} />)

    expect(screen.getByRole('heading', { name: /Powertrain/ })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('No motor data available')).toBeInTheDocument()
    // None of the metric-card labels render in the empty branch.
    expect(screen.queryByText('Shift State')).toBeNull()
    expect(screen.queryByText('Pack Voltage')).toBeNull()
    // The peak-temp formatter is never reached with no data.
    expect(mockFormatTemperature).not.toHaveBeenCalled()
  })

  it('renders the same placeholder when data is undefined', () => {
    render(<MotorSection motorData={undefined} />)

    expect(screen.getByText('No motor data available')).toBeInTheDocument()
    expect(screen.queryByText('Front RPM')).toBeNull()
    expect(mockFormatTemperature).not.toHaveBeenCalled()
  })
})

describe('MotorSection — shift state', () => {
  it('surfaces the raw gear string', () => {
    render(<MotorSection motorData={makeMotor({ shift_state: 'R' })} />)

    expect(screen.getByText('Shift State')).toBeInTheDocument()
    expect(within(card('Shift State')).getByText('R')).toBeInTheDocument()
  })

  it('falls back to an em dash when shift_state is null', () => {
    render(<MotorSection motorData={makeMotor({ shift_state: null })} />)
    expect(card('Shift State')).toHaveTextContent('—')
  })
})

describe('MotorSection — pack voltage', () => {
  it('prefers the rear-axle bus voltage over the front and formats it in volts', () => {
    render(<MotorSection motorData={makeMotor({ vbat_rear: 400, vbat_front: 390 })} />)

    expect(screen.getByText('400.00 V')).toBeInTheDocument()
    expect(screen.queryByText('390.00 V')).toBeNull()
  })

  it('falls back to the front-axle voltage when the rear is null', () => {
    render(<MotorSection motorData={makeMotor({ vbat_rear: null, vbat_front: 390 })} />)
    expect(screen.getByText('390.00 V')).toBeInTheDocument()
  })

  it('preserves a genuine 0 V rear reading instead of falling through to the front', () => {
    // Guards the `??` (not `||`) coalescing: 0 is a real reading, not "missing".
    render(<MotorSection motorData={makeMotor({ vbat_rear: 0, vbat_front: 390 })} />)

    expect(within(card('Pack Voltage')).getByText('0.00 V')).toBeInTheDocument()
    expect(screen.queryByText('390.00 V')).toBeNull()
  })

  it('shows an em dash when neither axle reports a voltage', () => {
    render(<MotorSection motorData={makeMotor({ vbat_rear: null, vbat_front: null })} />)
    expect(card('Pack Voltage')).toHaveTextContent('—')
  })
})

describe('MotorSection — motor current', () => {
  it('formats the front-axle current in amperes', () => {
    render(<MotorSection motorData={makeMotor({ motor_current_front: 250 })} />)
    expect(screen.getByText('250.00 A')).toBeInTheDocument()
  })

  it('keeps a genuine 0 A reading', () => {
    render(<MotorSection motorData={makeMotor({ motor_current_front: 0 })} />)
    expect(within(card('Motor Current (F)')).getByText('0.00 A')).toBeInTheDocument()
  })

  it('renders an em dash when the current is null', () => {
    render(<MotorSection motorData={makeMotor({ motor_current_front: null })} />)
    expect(card('Motor Current (F)')).toHaveTextContent('—')
  })
})

describe('MotorSection — torque split', () => {
  it('renders front + rear torque in Nm', () => {
    render(<MotorSection motorData={makeMotor({ torque_nm_front: 320.5, torque_nm_rear: 280 })} />)

    expect(screen.getByText('Front Torque')).toBeInTheDocument()
    expect(screen.getByText('Rear Torque')).toBeInTheDocument()
    expect(screen.getByText('320.50 Nm')).toBeInTheDocument()
    expect(screen.getByText('280.00 Nm')).toBeInTheDocument()
  })

  it('renders an em dash independently for each null axle', () => {
    render(<MotorSection motorData={makeMotor({ torque_nm_front: null, torque_nm_rear: 280 })} />)

    expect(card('Front Torque')).toHaveTextContent('—')
    expect(within(card('Rear Torque')).getByText('280.00 Nm')).toBeInTheDocument()
  })
})

describe('MotorSection — motor RPM', () => {
  it('renders front + rear RPM as locale-grouped integers', () => {
    render(<MotorSection motorData={makeMotor({ motor_rpm_front: 2400, motor_rpm_rear: 1800 })} />)

    expect(screen.getByText('Front RPM')).toBeInTheDocument()
    expect(screen.getByText('Rear RPM')).toBeInTheDocument()
    expect(screen.getByText('2,400')).toBeInTheDocument()
    expect(screen.getByText('1,800')).toBeInTheDocument()
  })

  it('preserves a genuine 0 RPM reading while the other axle still formats', () => {
    render(<MotorSection motorData={makeMotor({ motor_rpm_front: 0, motor_rpm_rear: 1800 })} />)

    expect(within(card('Front RPM')).getByText('0')).toBeInTheDocument()
    expect(screen.getByText('1,800')).toBeInTheDocument()
  })

  it('renders an em dash for a null RPM axle', () => {
    render(<MotorSection motorData={makeMotor({ motor_rpm_front: null, motor_rpm_rear: 1800 })} />)
    expect(card('Front RPM')).toHaveTextContent('—')
  })
})

describe('MotorSection — peak motor temperature', () => {
  it('delegates the higher of the two axle temps (raw °C) to formatTemperature', () => {
    render(
      <MotorSection motorData={makeMotor({ motor_temp_c_front: 45, motor_temp_c_rear: 60 })} />,
    )

    expect(mockFormatTemperature).toHaveBeenCalledWith(60)
    expect(screen.getByText('60°C')).toBeInTheDocument()
  })

  it('picks the front axle when it is the hotter of the two', () => {
    render(
      <MotorSection motorData={makeMotor({ motor_temp_c_front: 70, motor_temp_c_rear: 50 })} />,
    )

    expect(mockFormatTemperature).toHaveBeenCalledWith(70)
    expect(screen.getByText('70°C')).toBeInTheDocument()
  })

  it('works from a single populated axle without leaking the -Infinity sentinel', () => {
    render(
      <MotorSection motorData={makeMotor({ motor_temp_c_front: null, motor_temp_c_rear: 55 })} />,
    )

    expect(mockFormatTemperature).toHaveBeenCalledWith(55)
    expect(mockFormatTemperature).not.toHaveBeenCalledWith(-Infinity)
    expect(screen.getByText('55°C')).toBeInTheDocument()
  })

  it('shows an em dash and skips the formatter entirely when neither axle reports', () => {
    render(
      <MotorSection
        motorData={makeMotor({ motor_temp_c_front: null, motor_temp_c_rear: null })}
      />,
    )

    expect(card('Motor Temp (peak)')).toHaveTextContent('—')
    // The finite-guard short-circuits before any formatTemperature call —
    // crucially it never passes the -Infinity Math.max sentinel through.
    expect(mockFormatTemperature).not.toHaveBeenCalled()
  })
})

describe('MotorSection — accessibility', () => {
  it('marks every decorative icon (title glyph + all eight card glyphs) aria-hidden', () => {
    const { container } = render(<MotorSection motorData={makeMotor()} />)

    const svgs = container.querySelectorAll('svg')
    // Cog title glyph + 8 metric-card glyphs.
    expect(svgs.length).toBe(9)
    svgs.forEach((svg) => expect(svg).toHaveAttribute('aria-hidden', 'true'))
  })

  it('gives the panel an accessible Powertrain heading not polluted by the icon', () => {
    render(<MotorSection motorData={makeMotor()} />)
    // The Cog is aria-hidden, so the heading's accessible name is just the copy.
    expect(screen.getByRole('heading', { name: 'Powertrain' })).toBeInTheDocument()
  })
})
