/**
 * VehicleHeader — behavioural coverage + hardening regression tests.
 *
 * VehicleHeader is a prop-driven presentational header for the vehicle-detail
 * surface: a back affordance, the vehicle name + derived status badge, a
 * model/trim/VIN meta line, and a Wake action that refetches live state a few
 * seconds after the command settles. This suite pins the behaviours that would
 * silently regress and that the hardening pass fixed — never a smoke render,
 * never real network:
 *
 *   1. Populated render — display name, model/trim + VIN meta, the derived
 *      status badge, an accessible (aria-labelled) back link → /vehicles, and an
 *      enabled Wake button.
 *   2. Name fallback — a blank/whitespace display_name falls back to the VIN.
 *   3. No-vehicle hardening — generic "Vehicle" title, an 'offline' badge, the
 *      "details unavailable" placeholder (never a dangling "· " separator), and
 *      a DISABLED Wake button (was previously enabled → would POST
 *      /vehicles/0/wake).
 *   4. Status derivation — getVehicleStatus stays real, so charging / driving /
 *      online / offline branches are exercised end-to-end.
 *   5. Wake command — clicking Wake calls the mutation with the vehicle id.
 *   6. Deferred refetch — onRefetchState fires exactly once and ONLY after the
 *      settle delay (not synchronously on success).
 *   7. Timer-leak regression — unmounting before the delay cancels the pending
 *      refetch, so no state update lands on an unmounted tree.
 *   8. Loading state — a pending command yields a disabled, aria-busy button.
 *   9. Guard — the disabled Wake button never dispatches the mutation.
 *
 * Per the repo convention (see the sibling VehicleSettingsTab/DriveDetailHeader
 * suites): react-i18next is stubbed to echo the English fallback so asserted
 * copy is decoupled from the locale bundle; <FadeIn> is flattened to a plain
 * div (framer-motion + matchMedia are irrelevant here); getVehicleStatus is the
 * real derivation and useWakeVehicle is the single mocked seam. The real
 * <Button>, <StatusBadge>, and react-router <Link> render inside a
 * <MemoryRouter>. Network is never hit.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Vehicle, VehicleState } from '@/api/types'

// Echo the English fallback (2nd arg) so assertions read on real copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

// Flatten the entry animation — framer-motion / matchMedia are irrelevant here.
vi.mock('@/components/motion/FadeIn', () => ({
  FadeIn: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}))

// The only network seam is the wake mutation. getVehicleStatus stays the real
// derivation so the status-badge branches run end-to-end. `mutate` + `pending`
// are hoisted so the (hoisted) mock factory can close over them safely.
const { mutate, pending } = vi.hoisted(() => ({
  mutate: vi.fn(),
  pending: { value: false },
}))

vi.mock('@/api/hooks/useVehicles', async () => {
  const types = await vi.importActual<typeof import('@/api/types')>('@/api/types')
  return {
    getVehicleStatus: types.deriveVehicleStatus,
    useWakeVehicle: () => ({ mutate, isPending: pending.value }),
  }
})

import { VehicleHeader } from './VehicleHeader'

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 7,
    vehicle_id: 7,
    vin: '5YJ3E1EA7KF000000',
    display_name: 'Lightning',
    model: 'Model 3',
    trim_badging: 'Long Range',
    exterior_color: 'Red',
    wheel_type: 'Aero',
    state: 'online',
    healthy: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  } as Vehicle
}

function makeState(overrides: Partial<VehicleState> = {}): VehicleState {
  return { vehicle_id: 7, state: 'online', ...overrides } as VehicleState
}

function renderHeader(props: {
  vehicle?: Vehicle
  state?: VehicleState
  onRefetchState?: () => void
}) {
  const onRefetchState = props.onRefetchState ?? vi.fn()
  const utils = render(
    <MemoryRouter>
      <VehicleHeader vehicle={props.vehicle} state={props.state} onRefetchState={onRefetchState} />
    </MemoryRouter>,
  )
  return { ...utils, onRefetchState }
}

/** Pull the onSuccess callback the component handed to the wake mutation. */
function capturedOnSuccess(): () => void {
  const call = mutate.mock.calls[0]
  const opts = call?.[1] as { onSuccess?: () => void } | undefined
  if (!opts?.onSuccess) throw new Error('wake mutation was called without an onSuccess handler')
  return opts.onSuccess
}

beforeEach(() => {
  mutate.mockReset()
  pending.value = false
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('VehicleHeader — rendering', () => {
  it('renders the display name, model/VIN meta, derived status, and an accessible back link', () => {
    renderHeader({ vehicle: makeVehicle(), state: makeState({ is_charging: true }) })

    // Heading uses the display name.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Lightning')

    // Meta line surfaces model + trim and the VIN.
    const subtitle = screen.getByTestId('vehicle-header-subtitle')
    expect(subtitle).toHaveTextContent('Model 3 Long Range')
    expect(subtitle).toHaveTextContent('5YJ3E1EA7KF000000')

    // Derived status: is_charging → 'charging'.
    expect(screen.getByText('charging')).toBeInTheDocument()

    // Icon-only back link exposes an accessible name + destination.
    const back = screen.getByRole('link', { name: 'Back' })
    expect(back).toHaveAttribute('href', '/vehicles')

    // Wake action is enabled for a real vehicle.
    expect(screen.getByRole('button', { name: /Wake Up/i })).toBeEnabled()
  })

  it('falls back to the VIN when the display name is blank', () => {
    renderHeader({ vehicle: makeVehicle({ display_name: '   ' }), state: makeState() })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('5YJ3E1EA7KF000000')
  })

  it('shows safe fallbacks and disables Wake when there is no vehicle', () => {
    renderHeader({ vehicle: undefined, state: undefined })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Vehicle')
    expect(screen.getByText('offline')).toBeInTheDocument()
    expect(screen.getByTestId('vehicle-header-subtitle')).toHaveTextContent(
      'Vehicle details unavailable',
    )
    expect(screen.getByRole('button', { name: /Wake Up/i })).toBeDisabled()
  })
})

describe('VehicleHeader — status derivation', () => {
  it('derives the badge from live state (driving / online / offline)', () => {
    const { rerender } = renderHeader({
      vehicle: makeVehicle(),
      state: makeState({ speed: 42, is_charging: false }),
    })
    expect(screen.getByText('driving')).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <VehicleHeader
          vehicle={makeVehicle()}
          state={makeState({ state: 'online', speed: 0 })}
          onRefetchState={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('online')).toBeInTheDocument()

    // Vehicle present but no live state → 'offline'.
    rerender(
      <MemoryRouter>
        <VehicleHeader vehicle={makeVehicle()} state={undefined} onRefetchState={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('offline')).toBeInTheDocument()
  })
})

describe('VehicleHeader — wake command', () => {
  it('sends a wake command with the vehicle id when Wake is clicked', () => {
    renderHeader({ vehicle: makeVehicle({ id: 99 }), state: makeState() })

    fireEvent.click(screen.getByRole('button', { name: /Wake Up/i }))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(99, expect.objectContaining({ onSuccess: expect.any(Function) }))
  })

  it('refetches live state once, and only after the wake settle delay', () => {
    vi.useFakeTimers()
    const onRefetchState = vi.fn()
    renderHeader({ vehicle: makeVehicle({ id: 5 }), state: makeState(), onRefetchState })

    fireEvent.click(screen.getByRole('button', { name: /Wake Up/i }))
    expect(mutate).toHaveBeenCalledWith(5, expect.objectContaining({ onSuccess: expect.any(Function) }))

    // Simulate the mutation resolving — the refetch is deferred, not immediate.
    act(() => {
      capturedOnSuccess()()
    })
    expect(onRefetchState).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(onRefetchState).toHaveBeenCalledTimes(1)
  })

  it('cancels the pending refetch when unmounted before the delay elapses', () => {
    vi.useFakeTimers()
    const onRefetchState = vi.fn()
    const { unmount } = renderHeader({
      vehicle: makeVehicle({ id: 3 }),
      state: makeState(),
      onRefetchState,
    })

    fireEvent.click(screen.getByRole('button', { name: /Wake Up/i }))
    act(() => {
      capturedOnSuccess()()
    })

    unmount()
    act(() => {
      vi.advanceTimersByTime(10000)
    })
    expect(onRefetchState).not.toHaveBeenCalled()
  })
})

describe('VehicleHeader — loading + guards', () => {
  it('shows a busy, disabled Wake button while the command is pending', () => {
    pending.value = true
    renderHeader({ vehicle: makeVehicle(), state: makeState() })

    const btn = screen.getByRole('button', { name: /Wake Up/i })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })

  it('never dispatches a wake command from the disabled (no-vehicle) button', () => {
    renderHeader({ vehicle: undefined, state: undefined })
    fireEvent.click(screen.getByRole('button', { name: /Wake Up/i }))
    expect(mutate).not.toHaveBeenCalled()
  })
})
