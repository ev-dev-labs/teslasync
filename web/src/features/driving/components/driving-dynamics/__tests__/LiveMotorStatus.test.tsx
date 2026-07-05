/**
 * LiveMotorStatus — live cockpit motor gauges (single default export).
 *
 * The component is pure and props-driven — it fetches nothing, so no
 * QueryClient / network mock is required. react-i18next is stubbed to
 * echo the English fallback, matching the sibling suites in this folder.
 *
 * Coverage:
 *   - panel-level empty state when `motorLatest` is null AND undefined
 *   - the four-gauge grid (torque total, front rpm, hottest motor temp,
 *     shift-state badge) on the happy path
 *   - null-safe torque summation when one axle is missing
 *   - hottest-axle motor-temp selection + display-unit conversion (°F)
 *     with a regression guard against a doubled degree symbol
 *   - the "Awaiting data" temp fallback (both axle temps absent) and the
 *     zero-safe torque / rpm captions — the grid still renders rather
 *     than collapsing to the panel-level empty state
 *   - shift-state colour coding (Drive → success, else neutral) and the
 *     descriptive accessible name on the icon + single-letter chip
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>
          if (typeof o.defaultValue === 'string') return o.defaultValue
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import LiveMotorStatus from '../LiveMotorStatus'
import type { MotorSnapshot } from '@/api/types'
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat'

// `fmtNumber` reads module-global precision + locale. Pin them so the
// "500.00 Nm" / "12,000 RPM" / "50.0°C" assertions are deterministic
// regardless of suite ordering.
beforeAll(() => {
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
})

const identity = (v: number) => v
const cToF = (c: number) => (c * 9) / 5 + 32

/** Build a fully-typed MotorSnapshot with every field null by default. */
function snapshot(overrides: Partial<MotorSnapshot> = {}): MotorSnapshot {
  return {
    ts: '2026-07-05T00:00:00Z',
    created_at: '2026-07-05T00:00:00Z',
    torque_nm_front: null,
    torque_nm_rear: null,
    di_torque: null,
    motor_rpm_front: null,
    motor_rpm_rear: null,
    motor_temp_c_front: null,
    motor_temp_c_rear: null,
    inverter_temp_c: null,
    inverter_temp_rear: null,
    heatsink_temp_front: null,
    heatsink_temp_rear: null,
    motor_current_front: null,
    motor_current_rear: null,
    state_front: null,
    state_rear: null,
    shift_state: null,
    vbat_front: null,
    vbat_rear: null,
    ...overrides,
  }
}

describe('LiveMotorStatus — empty / awaiting-source state', () => {
  it('renders the panel-level empty state when motorLatest is null', () => {
    render(<LiveMotorStatus motorLatest={null} toTemperatureDisplay={identity} tempUnit="°C" />)

    // Panel title is ALWAYS shown (never hide the whole section).
    expect(screen.getByRole('heading', { name: 'Live Motor Status' })).toBeInTheDocument()
    // EmptyState renders role="status" with the awaiting message.
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Awaiting live motor data')).toBeInTheDocument()
    // None of the gauges render in the empty branch.
    expect(screen.queryByText('Torque')).toBeNull()
    expect(screen.queryByText('Front RPM')).toBeNull()
  })

  it('renders the panel-level empty state when motorLatest is undefined', () => {
    render(<LiveMotorStatus motorLatest={undefined} toTemperatureDisplay={identity} tempUnit="°C" />)

    expect(screen.getByRole('heading', { name: 'Live Motor Status' })).toBeInTheDocument()
    expect(screen.getByText('Awaiting live motor data')).toBeInTheDocument()
    expect(screen.queryByText('Motor')).toBeNull()
  })
})

describe('LiveMotorStatus — four-gauge cockpit grid', () => {
  it('renders torque total, front rpm, hottest motor temp and drive shift state', () => {
    const snap = snapshot({
      torque_nm_front: 300,
      torque_nm_rear: 200,
      motor_rpm_front: 12000,
      motor_temp_c_front: 50,
      motor_temp_c_rear: 45,
      shift_state: 'D',
    })
    const { container } = render(
      <LiveMotorStatus motorLatest={snap} toTemperatureDisplay={identity} tempUnit="°C" />,
    )

    // Gauge labels.
    expect(screen.getByText('Torque')).toBeInTheDocument()
    expect(screen.getByText('Front RPM')).toBeInTheDocument()
    expect(screen.getByText('Motor')).toBeInTheDocument()

    // Captions: torque = front + rear = 500; rpm formatted with grouping;
    // motor temp = the hotter axle (50 not 45).
    expect(screen.getByText('500.00 Nm')).toBeInTheDocument()
    expect(screen.getByText('12,000 RPM')).toBeInTheDocument()
    expect(screen.getByText('50.0°C')).toBeInTheDocument()

    // The empty state must be gone, and no doubled degree symbol.
    expect(screen.queryByText('Awaiting live motor data')).toBeNull()
    expect(container.textContent).not.toMatch(/°°/)
  })

  it('sums only the present axle torque when the other axle is null', () => {
    const snap = snapshot({
      torque_nm_front: 250,
      torque_nm_rear: null,
      motor_rpm_front: 8000,
      motor_temp_c_front: 30,
      shift_state: 'D',
    })
    render(<LiveMotorStatus motorLatest={snap} toTemperatureDisplay={identity} tempUnit="°C" />)

    // Rear null must coerce to 0, not NaN — total is the front value.
    expect(screen.getByText('250.00 Nm')).toBeInTheDocument()
    expect(screen.getByText('8,000 RPM')).toBeInTheDocument()
    // Rear temp null → the -Infinity sentinel is ignored, front wins.
    expect(screen.getByText('30.0°C')).toBeInTheDocument()
  })
})

describe('LiveMotorStatus — motor temperature', () => {
  it('selects the hotter axle and converts to the display unit (°F)', () => {
    const snap = snapshot({ motor_temp_c_front: 40, motor_temp_c_rear: 90, shift_state: 'P' })
    const { container } = render(
      <LiveMotorStatus motorLatest={snap} toTemperatureDisplay={cToF} tempUnit="°F" />,
    )

    // 90°C is the hotter axle → 194°F. If it had wrongly picked the
    // cooler front axle it would render 104.0°F.
    expect(screen.getByText('194.0°F')).toBeInTheDocument()
    expect(screen.queryByText('104.0°F')).toBeNull()
    // The unit pref already includes the degree — never double it.
    expect(container.textContent).not.toMatch(/°°/)
  })

  it('shows the awaiting-data caption when both motor temps are absent', () => {
    const snap = snapshot({ shift_state: 'P' }) // all torque / rpm / temp null
    render(<LiveMotorStatus motorLatest={snap} toTemperatureDisplay={identity} tempUnit="°C" />)

    // Both axle temps null → Math.max(-Infinity, -Infinity) is not finite
    // → the caption falls back rather than rendering "NaN°C" or "0.0°C".
    expect(screen.getByText('Awaiting data')).toBeInTheDocument()
    // The grid still renders — this is NOT the panel-level empty state.
    expect(screen.getByText('Torque')).toBeInTheDocument()
    expect(screen.queryByText('Awaiting live motor data')).toBeNull()
    // Zero-safe numeric captions for the missing torque / rpm signals.
    expect(screen.getByText('0.00 Nm')).toBeInTheDocument()
    expect(screen.getByText('0 RPM')).toBeInTheDocument()
  })
})

describe('LiveMotorStatus — shift state', () => {
  it('colour-codes Drive as success and exposes a descriptive accessible name', () => {
    const snap = snapshot({ shift_state: 'D' })
    render(<LiveMotorStatus motorLatest={snap} toTemperatureDisplay={identity} tempUnit="°C" />)

    const badge = screen.getByLabelText('Shift State: D')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('D')
    // Drive is visually distinguished via the success (green) variant.
    expect(badge.className).toContain('bg-green')
    // The caption below the chip labels it for sighted users.
    expect(screen.getByText('Shift State')).toBeInTheDocument()
  })

  it('falls back to Unknown (neutral variant) when shift_state is null', () => {
    const snap = snapshot({ shift_state: null })
    render(<LiveMotorStatus motorLatest={snap} toTemperatureDisplay={identity} tempUnit="°C" />)

    const badge = screen.getByLabelText('Shift State: Unknown')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('Unknown')
    // Neutral (grey), NOT the success variant reserved for Drive.
    expect(badge.className).toContain('bg-gray')
    expect(badge.className).not.toContain('bg-green')
  })
})
