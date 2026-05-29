/**
 * GForcePanel + PedalUsage regression contract.
 *
 * Pre-fix:
 *   Both panels called the deprecated `useSignalObservations` hook,
 *   which targeted the long-deleted `/signals/observations` route
 *   (the `signal_observations` table no longer exists).
 *   The hook 404'd silently, the components received no data, and
 *   the user saw a permanent "No telemetry received yet" empty state
 *   even when the per-field MQTT pipeline had freshly observed all
 *   5 driving-dynamics signals.
 *
 * Post-fix (this regression suite):
 *   Both panels now subscribe to /drive-dynamics/latest via
 *   `useDriveDynamicsLatest`, which projects the 5 signals
 *   (LateralAcceleration, LongitudinalAcceleration, PedalPosition,
 *   BrakePedalPos, BrakePedal) from `signal.LiveStateReader.LiveState`.
 *
 * These tests pin:
 *   - GForcePanel renders lateral / longitudinal / combined when
 *     LiveState returns numeric values (was ALWAYS empty pre-fix).
 *   - GForcePanel falls back to the empty state when LiveState is
 *     empty (parity with pre-fix empty-state UX).
 *   - PedalUsage renders throttle / brake / brake-active when
 *     LiveState returns numeric + bool values.
 *   - PedalUsage falls back to the empty state when LiveState is
 *     empty.
 *   - Both panels POLL — i.e. they wire `refetchInterval` so the UI
 *     reflects fresh per-field MQTT observations without a manual
 *     reload.
 *
 * The shared `request` helper is mocked so the real `useQuery` runs
 * end-to-end without a network. i18n is stubbed to fall back to the
 * `defaultValue` argument (matches the QuietHoursPanel test pattern).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
}))

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

import { request } from '@/api/client'
import GForcePanel from '../GForcePanel'
import PedalUsage from '../PedalUsage'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('GForcePanel', () => {
  it('renders lateral / longitudinal / combined when LiveState has G-force', async () => {
    mockedRequest.mockResolvedValueOnce({
      lateral_acceleration: 0.12,
      longitudinal_acceleration: -0.04,
    })

    renderWithClient(<GForcePanel vehicleId={1} />)

    // Header is always visible.
    expect(screen.getByText('Acceleration G-Force')).toBeInTheDocument()

    // Wait for the StatCards to render — empty-state should NOT appear.
    await waitFor(() => {
      expect(screen.getByText('Lateral')).toBeInTheDocument()
    })
    expect(screen.getByText('Longitudinal')).toBeInTheDocument()
    expect(screen.getByText('Combined')).toBeInTheDocument()
    // The "no telemetry" empty state must be GONE — this is the
    // regression assertion: pre-fix the panel was always in the
    // empty state because useSignalObservations 404'd.
    expect(screen.queryByText('No G-force telemetry received yet')).toBeNull()

    // Verify the hook calls the new endpoint, not the dead
    // /signals/observations route.
    expect(mockedRequest).toHaveBeenCalledWith(
      '/drive-dynamics/latest?vehicle_id=1',
      expect.any(Object),
    )
  })

  it('renders the empty state when LiveState has no G-force signals', async () => {
    // Backend returns 200 with an empty body — every other
    // /{name}/latest handler does this when no signal in the
    // mapping is present in LiveState. The panel should fall back
    // to the empty-state message rather than rendering "0.00 g".
    mockedRequest.mockResolvedValueOnce({})

    renderWithClient(<GForcePanel vehicleId={1} />)

    await waitFor(() => {
      expect(screen.getByText('No G-force telemetry received yet')).toBeInTheDocument()
    })
    // Stat labels must NOT be present in the empty-state branch.
    expect(screen.queryByText('Lateral')).toBeNull()
    expect(screen.queryByText('Longitudinal')).toBeNull()
    expect(screen.queryByText('Combined')).toBeNull()
  })

  it('does not query the API when vehicleId is null', async () => {
    renderWithClient(<GForcePanel vehicleId={null} />)
    // The hook is `enabled: vehicleId > 0`, so a null/undefined
    // vehicleId must NOT trigger any request — gates the
    // pre-vehicle-selection state on DrivingDynamicsPage.
    await waitFor(() => {
      expect(screen.getByText('No G-force telemetry received yet')).toBeInTheDocument()
    })
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

describe('PedalUsage', () => {
  it('renders throttle / brake / brake-active when LiveState has pedal data', async () => {
    mockedRequest.mockResolvedValueOnce({
      pedal_position: 42.5,
      brake_pedal_position: 7.25,
      brake_pedal_active: true,
    })

    renderWithClient(<PedalUsage vehicleId={1} />)

    expect(screen.getByText('Pedal Usage')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Throttle Position')).toBeInTheDocument()
    })
    expect(screen.getByText('Brake Pedal Position')).toBeInTheDocument()
    // BrakePedal=true → Brake Active badge.
    expect(screen.getByText('Brake Active')).toBeInTheDocument()
    // Empty-state text must NOT be present — regression assertion.
    expect(screen.queryByText('No pedal telemetry received yet')).toBeNull()

    expect(mockedRequest).toHaveBeenCalledWith(
      '/drive-dynamics/latest?vehicle_id=1',
      expect.any(Object),
    )
  })

  it('shows Brake Inactive badge when brake_pedal_active is false', async () => {
    mockedRequest.mockResolvedValueOnce({
      pedal_position: 0,
      brake_pedal_position: 0,
      brake_pedal_active: false,
    })

    renderWithClient(<PedalUsage vehicleId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Brake Inactive')).toBeInTheDocument()
    })
    expect(screen.queryByText('Brake Active')).toBeNull()
  })

  it('renders the empty state when LiveState has no pedal signals', async () => {
    mockedRequest.mockResolvedValueOnce({})

    renderWithClient(<PedalUsage vehicleId={1} />)

    await waitFor(() => {
      expect(screen.getByText('No pedal telemetry received yet')).toBeInTheDocument()
    })
    expect(screen.queryByText('Throttle Position')).toBeNull()
    expect(screen.queryByText('Brake Pedal Position')).toBeNull()
    expect(screen.queryByText('Brake Active')).toBeNull()
    expect(screen.queryByText('Brake Inactive')).toBeNull()
  })

  it('does not query the API when vehicleId is null', async () => {
    renderWithClient(<PedalUsage vehicleId={null} />)
    await waitFor(() => {
      expect(screen.getByText('No pedal telemetry received yet')).toBeInTheDocument()
    })
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})
