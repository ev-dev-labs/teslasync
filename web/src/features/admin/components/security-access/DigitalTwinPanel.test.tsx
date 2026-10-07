/**
 * DigitalTwinPanel contract tests.
 *
 * DigitalTwinPanel is a pure, prop-driven presentational shell that selects
 * exactly one of four mutually-exclusive states — error / loading / data /
 * empty — and always renders its "Digital Twin" panel title. These tests pin:
 *
 *  1. The panel title heading renders in EVERY state (never a headless panel).
 *  2. Each of the four branches renders its expected child and nothing else.
 *  3. Branch PRIORITY: error > (loading && !data) > data > empty. In
 *     particular, a background refetch (isLoading && hasData) keeps showing
 *     the twin rather than flashing back to a skeleton.
 *  4. Prop pass-through to <VehicleTwin> (vehicleId, size, interactive, and
 *     the spread twinState) — the component's real contract.
 *  5. onRetry is forwarded to <QueryError> and fires on click.
 *  6. The loading branch is an accessible live region (role="status" +
 *     aria-busy) so screen-reader users are told the panel is working.
 *  7. className is forwarded to the underlying GlassPanel.
 *  8. A missing vehicleId (undefined) does not crash the data branch.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        // t(key, defaultStr, opts) signature — return the default, with
        // {{token}} interpolation when options are supplied.
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

// <VehicleTwin> is a heavy framer-motion SVG with its own paint hooks and is
// exhaustively covered by its own suite. Stub it to a marker element that
// echoes the props DigitalTwinPanel is contractually required to forward, so
// we can assert the wiring without rendering the animation.
vi.mock('@/components/vehicles', () => ({
  VehicleTwin: (props: {
    vehicleId?: number | null
    size?: string
    interactive?: boolean
    isCharging?: boolean
    locked?: boolean | null
  }) => (
    <div
      data-testid="vehicle-twin"
      data-vehicle-id={String(props.vehicleId)}
      data-size={props.size}
      data-interactive={String(props.interactive)}
      data-is-charging={String(props.isCharging)}
      data-locked={String(props.locked)}
    />
  ),
}))

import { DigitalTwinPanel } from './DigitalTwinPanel'
import type { VehicleTwinState } from '@/lib/vehicleState'

function makeTwinState(
  overrides: Partial<VehicleTwinState> = {},
): VehicleTwinState {
  return {
    doors: {
      driverFront: null,
      passengerFront: null,
      driverRear: null,
      passengerRear: null,
      trunkFront: null,
      trunkRear: null,
    },
    windowFD: null,
    windowFP: null,
    windowRD: null,
    windowRP: null,
    frunkOpen: null,
    trunkOpen: null,
    chargePortOpen: null,
    isCharging: false,
    isDriving: false,
    locked: null,
    sentryMode: null,
    headlights: null,
    hazards: null,
    turnSignal: null,
    driverSeatOccupied: null,
    vehicleColor: '',
    lastUpdated: null,
    ...overrides,
  }
}

type PanelProps = Parameters<typeof DigitalTwinPanel>[0]

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    twinState: makeTwinState(),
    vehicleId: 42,
    hasData: false,
    isLoading: false,
    error: null,
    ...overrides,
  }
  const utils = render(
    <MemoryRouter>
      <DigitalTwinPanel {...props} />
    </MemoryRouter>,
  )
  return { ...utils, props }
}

describe('DigitalTwinPanel', () => {
  it('always renders the "Digital Twin" panel title heading in every state', () => {
    const states: Partial<PanelProps>[] = [
      { hasData: false, isLoading: false, error: null }, // empty
      { hasData: false, isLoading: true, error: null }, // loading
      { hasData: true, isLoading: false, error: null }, // data
      { hasData: false, isLoading: false, error: new Error('x') }, // error
    ]
    for (const s of states) {
      const { unmount } = renderPanel(s)
      expect(
        screen.getByRole('heading', { name: /digital twin/i }),
      ).toBeInTheDocument()
      unmount()
    }
  })

  it('renders only the empty state when there is no data, no loading, and no error', () => {
    renderPanel({ hasData: false, isLoading: false, error: null })

    expect(
      screen.getByText(/no live vehicle state available yet/i),
    ).toBeInTheDocument()
    expect(screen.queryByTestId('vehicle-twin')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('status', { name: /loading/i }),
    ).not.toBeInTheDocument()
  })

  it('renders an accessible loading region (role=status + aria-busy) while loading with no data', () => {
    renderPanel({ hasData: false, isLoading: true, error: null })

    const region = screen.getByRole('status', { name: /loading/i })
    expect(region).toBeInTheDocument()
    expect(region).toHaveAttribute('aria-busy', 'true')
    // The twin and empty branches must NOT render in the loading state.
    expect(screen.queryByTestId('vehicle-twin')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/no live vehicle state/i),
    ).not.toBeInTheDocument()
  })

  it('renders <VehicleTwin> and forwards vehicleId, size, interactive, and the spread twinState when data is present', () => {
    renderPanel({
      hasData: true,
      vehicleId: 7,
      twinState: makeTwinState({ isCharging: true, locked: true }),
    })

    const twin = screen.getByTestId('vehicle-twin')
    expect(twin).toBeInTheDocument()
    expect(twin).toHaveAttribute('data-vehicle-id', '7')
    expect(twin).toHaveAttribute('data-size', 'sm')
    expect(twin).toHaveAttribute('data-interactive', 'true')
    // Proves the whole twinState object is spread onto <VehicleTwin>.
    expect(twin).toHaveAttribute('data-is-charging', 'true')
    expect(twin).toHaveAttribute('data-locked', 'true')
    // No competing states.
    expect(
      screen.queryByRole('status', { name: /loading/i }),
    ).not.toBeInTheDocument()
  })

  it('renders <QueryError> and forwards onRetry, firing it on click', () => {
    const onRetry = vi.fn()
    renderPanel({ error: new Error('boom'), onRetry, hasData: false })

    const retry = screen.getByRole('button', { name: /retry/i })
    expect(retry).toBeInTheDocument()
    expect(screen.queryByTestId('vehicle-twin')).not.toBeInTheDocument()

    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('prioritises the error state over loading and data (error wins)', () => {
    renderPanel({
      error: new Error('down'),
      isLoading: true,
      hasData: true,
    })

    // Error branch → QueryError renders its alert region...
    expect(screen.getByRole('alert')).toBeInTheDocument()
    // ...and neither the skeleton nor the twin appear.
    expect(
      screen.queryByRole('status', { name: /loading/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('vehicle-twin')).not.toBeInTheDocument()
  })

  it('keeps showing the twin during a background refetch (isLoading && hasData → data, not skeleton)', () => {
    renderPanel({ isLoading: true, hasData: true, error: null })

    expect(screen.getByTestId('vehicle-twin')).toBeInTheDocument()
    expect(
      screen.queryByRole('status', { name: /loading/i }),
    ).not.toBeInTheDocument()
  })

  it('forwards className to the underlying GlassPanel', () => {
    const { container } = renderPanel({ className: 'xl:col-span-1' })
    const panel = container.querySelector('[data-print-card]')
    expect(panel).not.toBeNull()
    expect(panel).toHaveClass('xl:col-span-1')
  })

  it('does not crash the data branch when vehicleId is undefined', () => {
    renderPanel({ hasData: true, vehicleId: undefined })

    const twin = screen.getByTestId('vehicle-twin')
    expect(twin).toBeInTheDocument()
    expect(twin).toHaveAttribute('data-vehicle-id', 'undefined')
  })
})
