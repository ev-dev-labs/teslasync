/**
 * LiveMotorStatus — live cockpit powertrain readout (single default export).
 *
 * The panel owns its own `useMotorLatest` subscription (REALTIME cadence)
 * rather than receiving a snapshot prop from the page, so the hook is stubbed
 * and driven from `mockMotorQuery`. react-i18next is stubbed to echo the
 * English fallback, matching the sibling suites in this folder.
 *
 * Coverage:
 *   - panel-level empty state when the query resolves null AND undefined
 *   - loading and error branches (a failed first load must not masquerade as
 *     "no telemetry")
 *   - the readout grid — torque total, front/rear axle speed, hottest motor
 *     temp, shift-state badge — on the happy path
 *   - null-safe torque summation when one axle is missing, and the
 *     all-axles-absent case reading "—" rather than a confident 0
 *   - **signed** torque and axle speed: regenerative braking and reverse must
 *     render as negative readings, NOT clamp to zero the way the previous
 *     RadialGauge presentation did
 *   - hottest-axle motor-temp selection, display-unit conversion (°F), a
 *     regression guard against a doubled degree symbol, AND a guard that the
 *     temperature ring sweeps the same fraction in °C and °F (the offset-scale
 *     bug: a 0→max ring silently changed meaning with the unit preference)
 *   - shift-state colour coding (Drive → success, else neutral) and the
 *     descriptive accessible name on the chip
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

interface MockMotorQuery {
  data: MotorSnapshot | null | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => void
}

let mockMotorQuery: MockMotorQuery

vi.mock('@/api/hooks/useVehicles', () => ({
  useMotorLatest: () => mockMotorQuery,
}))

import LiveMotorStatus from '../LiveMotorStatus'
import type { MotorSnapshot } from '@/api/types'
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat'
import { BADGE_VARIANTS } from '@/components/ui'

// `fmtNumber` reads module-global precision + locale. Pin them so the
// numeric assertions are deterministic regardless of suite ordering.
beforeAll(() => {
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
})

beforeEach(() => {
  mockMotorQuery = {
    data: null,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
  }
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

function renderPanel(
  data: MotorSnapshot | null | undefined,
  opts: {
    toTemperatureDisplay?: (v: number) => number
    tempUnit?: '°C' | '°F'
    isLoading?: boolean
    isError?: boolean
  } = {},
) {
  mockMotorQuery = {
    data,
    isLoading: opts.isLoading ?? false,
    isError: opts.isError ?? false,
    error: opts.isError ? new Error('boom') : null,
    refetch: () => {},
  }
  return render(
    <MemoryRouter>
      <LiveMotorStatus
        vehicleId={1}
        toTemperatureDisplay={opts.toTemperatureDisplay ?? identity}
        tempUnit={opts.tempUnit ?? '°C'}
      />
    </MemoryRouter>,
  )
}

describe('LiveMotorStatus — empty / awaiting-source state', () => {
  it('renders the panel-level empty state when the snapshot is null', () => {
    renderPanel(null)

    // Panel title is ALWAYS shown (never hide the whole section).
    expect(screen.getByRole('heading', { name: 'Live Motor Status' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Awaiting live motor data')).toBeInTheDocument()
    // None of the readouts render in the empty branch.
    expect(screen.queryByText('Torque')).toBeNull()
    expect(screen.queryByText('Front RPM')).toBeNull()
  })

  it('renders the panel-level empty state when the snapshot is undefined', () => {
    renderPanel(undefined)

    expect(screen.getByRole('heading', { name: 'Live Motor Status' })).toBeInTheDocument()
    expect(screen.getByText('Awaiting live motor data')).toBeInTheDocument()
    expect(screen.queryByText('Motor')).toBeNull()
  })

  it('renders a spinner — not the empty state — while the first load is in flight', () => {
    renderPanel(undefined, { isLoading: true })

    expect(screen.getByRole('heading', { name: 'Live Motor Status' })).toBeInTheDocument()
    expect(screen.queryByText('Awaiting live motor data')).toBeNull()
  })

  it('surfaces a failed first load instead of a silent blank panel', () => {
    renderPanel(undefined, { isError: true })

    expect(screen.getByRole('heading', { name: 'Live Motor Status' })).toBeInTheDocument()
    expect(screen.queryByText('Awaiting live motor data')).toBeNull()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})

describe('LiveMotorStatus — powertrain readouts', () => {
  it('renders torque total, both axle speeds, hottest motor temp and shift state', () => {
    const { container } = renderPanel(
      snapshot({
        torque_nm_front: 300,
        torque_nm_rear: 200,
        motor_rpm_front: 12000,
        motor_rpm_rear: 11000,
        motor_temp_c_front: 50,
        motor_temp_c_rear: 45,
        shift_state: 'D',
      }),
    )

    // Torque total = front + rear = 500.
    expect(screen.getByLabelText('Torque')).toHaveAttribute('aria-valuenow', '500')
    expect(screen.getByLabelText('Front RPM')).toHaveAttribute('aria-valuenow', '12000')
    expect(screen.getByLabelText('Rear RPM')).toHaveAttribute('aria-valuenow', '11000')
    // Motor temp = the hotter axle (50 not 45).
    expect(screen.getByLabelText('Motor')).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByText('50.0°C')).toBeInTheDocument()

    expect(screen.queryByText('Awaiting live motor data')).toBeNull()
    expect(container.textContent).not.toMatch(/°°/)
  })

  it('sums only the present axle torque when the other axle is null', () => {
    renderPanel(
      snapshot({
        torque_nm_front: 250,
        torque_nm_rear: null,
        motor_rpm_front: 8000,
        motor_temp_c_front: 30,
        shift_state: 'D',
      }),
    )

    // Rear null must coerce to 0, not NaN — total is the front value.
    expect(screen.getByLabelText('Torque')).toHaveAttribute('aria-valuenow', '250')
    expect(screen.getByLabelText('Front RPM')).toHaveAttribute('aria-valuenow', '8000')
    // Rear temp null → the sentinel is ignored, front wins.
    expect(screen.getByText('30.0°C')).toBeInTheDocument()
  })
})

describe('LiveMotorStatus — signed powertrain values (regression)', () => {
  it('renders regenerative braking as NEGATIVE torque rather than clamping to zero', () => {
    renderPanel(
      snapshot({
        torque_nm_front: -80,
        torque_nm_rear: -120,
        motor_rpm_front: 4000,
        shift_state: 'D',
      }),
    )

    // The previous RadialGauge presentation clamped at 0, so a car braking
    // hard on regen was indistinguishable from a stationary one.
    const torque = screen.getByLabelText('Torque')
    expect(torque).toHaveAttribute('aria-valuenow', '-200')
    expect(Number(torque.getAttribute('aria-valuenow'))).toBeLessThan(0)
  })

  it('renders reverse as NEGATIVE axle speed rather than clamping to zero', () => {
    renderPanel(
      snapshot({
        motor_rpm_front: -1500,
        motor_rpm_rear: -1500,
        shift_state: 'R',
      }),
    )

    expect(screen.getByLabelText('Front RPM')).toHaveAttribute('aria-valuenow', '-1500')
    expect(screen.getByLabelText('Rear RPM')).toHaveAttribute('aria-valuenow', '-1500')
  })
})

describe('LiveMotorStatus — motor temperature', () => {
  it('selects the hotter axle and converts to the display unit (°F)', () => {
    const { container } = renderPanel(
      snapshot({ motor_temp_c_front: 40, motor_temp_c_rear: 90, shift_state: 'P' }),
      { toTemperatureDisplay: cToF, tempUnit: '°F' },
    )

    // 90°C is the hotter axle → 194°F. If it had wrongly picked the
    // cooler front axle it would render 104.0°F.
    expect(screen.getByText('194.0°F')).toBeInTheDocument()
    expect(screen.queryByText('104.0°F')).toBeNull()
    // The unit pref already includes the degree — never double it.
    expect(container.textContent).not.toMatch(/°°/)
  })

  it('sweeps the same arc fraction in °C and °F (offset-scale regression)', () => {
    // Temperature is an INTERVAL scale: its zero is arbitrary. A 0→max ring
    // therefore reads a different fraction for the same physical temperature
    // once the user switches to Fahrenheit. The gauge is passed a converted
    // `min` as well so the offset cancels — this pins that behaviour.
    const arcOffset = (root: HTMLElement): string => {
      const circles = root.querySelectorAll('circle')
      // [0] is the static track, [1] is the value arc.
      return circles[1]?.getAttribute('stroke-dashoffset') ?? ''
    }

    const celsius = renderPanel(snapshot({ motor_temp_c_front: 50, shift_state: 'P' }), {
      toTemperatureDisplay: identity,
      tempUnit: '°C',
    })
    const celsiusOffset = arcOffset(celsius.container as HTMLElement)
    celsius.unmount()

    const fahrenheit = renderPanel(snapshot({ motor_temp_c_front: 50, shift_state: 'P' }), {
      toTemperatureDisplay: cToF,
      tempUnit: '°F',
    })
    const fahrenheitOffset = arcOffset(fahrenheit.container as HTMLElement)

    expect(celsiusOffset).not.toBe('')
    expect(fahrenheitOffset).toBe(celsiusOffset)
  })

  it('shows the awaiting-data caption when both motor temps are absent', () => {
    // Torque present so the panel renders its grid rather than the
    // panel-level empty state.
    renderPanel(snapshot({ torque_nm_front: 10, shift_state: 'P' }))

    expect(screen.getByText('Awaiting data')).toBeInTheDocument()
    expect(screen.getByText('Torque')).toBeInTheDocument()
    expect(screen.queryByText('Awaiting live motor data')).toBeNull()
  })
})

describe('LiveMotorStatus — shift state', () => {
  it('colour-codes Drive as success and exposes a descriptive accessible name', () => {
    renderPanel(snapshot({ shift_state: 'D', torque_nm_front: 10 }))

    const badge = screen.getByLabelText('Shift State: D')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('D')
    // Drive is visually distinguished via the success (green) variant.
    expect(badge.className).toContain('bg-green')
    // The caption below the chip labels it for sighted users.
    expect(screen.getByText('Shift State')).toBeInTheDocument()
  })

  it('falls back to Unknown (neutral variant) when shift_state is null', () => {
    renderPanel(snapshot({ shift_state: null, torque_nm_front: 10 }))

    const badge = screen.getByLabelText('Shift State: Unknown')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('Unknown')
    // Neutral, NOT the success variant reserved for Drive. Asserted against the
    // exported Badge palette so a re-skin of the neutral chip cannot silently
    // invalidate this check.
    expect(badge.className).toContain(BADGE_VARIANTS.neutral)
    expect(badge.className).not.toContain('bg-green')
  })
})
