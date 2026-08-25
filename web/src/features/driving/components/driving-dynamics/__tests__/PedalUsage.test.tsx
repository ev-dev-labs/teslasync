/**
 * PedalUsage — dedicated behavioural + hardening contract.
 *
 * PedalUsage projects the live pedal surface (PedalPosition, BrakePedalPos,
 * BrakePedal) from /drive-dynamics/latest via `useDriveDynamicsLatest`, then
 * renders a throttle gauge, a brake gauge, and a brake-state badge.
 *
 * This suite pins the facets the shared DriveDynamicsPanels regression test
 * does not, and locks the states added while hardening the component:
 *   - header is always visible (loading / empty / error / data);
 *   - the endpoint is the un-prefixed, snake_case /drive-dynamics/latest;
 *   - throttle / brake gauge values + units render (`%` when present, `—`
 *     when the matching signal is absent);
 *   - the brake badge distinguishes Active / Inactive / Unknown — a MISSING
 *     brake signal must NOT masquerade as a confirmed green "Brake Inactive";
 *   - a first-load fetch shows a spinner, not the "no telemetry" empty state;
 *   - a first-load failure surfaces a QueryError with a working Retry that
 *     re-invokes the request (never a silent blank panel);
 *   - a null / undefined vehicleId keeps the query disabled (no network).
 *
 * The shared `request` client is mocked so the real `useQuery` runs end-to-end
 * without a network; i18n is stubbed to its fallback strings (mirrors the
 * sibling DriveDynamicsPanels / AutopilotSection tests).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

vi.mock('@/api/client', () => ({
  request: vi.fn(),
  // QueryError narrows on ApiError.status via isApiError; keep the real
  // duck-type guard so a plain Error falls through to the network branch.
  isApiError: (e: unknown): boolean =>
    !!e && typeof e === 'object' && 'status' in (e as Record<string, unknown>),
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
import PedalUsage from '../PedalUsage'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderWithClient(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('PedalUsage — data rendering', () => {
  it('renders throttle/brake gauges + Brake Active badge and hits the un-prefixed snake_case endpoint', async () => {
    mockedRequest.mockResolvedValueOnce({
      pedal_position: 42,
      brake_pedal_position: 8,
      brake_pedal_active: true,
    })

    renderWithClient(<PedalUsage vehicleId={1} />)

    // Header is rendered outside every state branch — visible immediately.
    expect(screen.getByText('Pedal Usage')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Throttle Position')).toBeInTheDocument()
    })
    expect(screen.getByText('Brake Pedal Position')).toBeInTheDocument()
    // Gauge values render (integers → no decimals).
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    // brake_pedal_active === true → danger "Brake Active".
    expect(screen.getByText('Brake Active')).toBeInTheDocument()
    expect(screen.queryByText('No pedal telemetry received yet')).toBeNull()

    // Client auto-adds /api/v1; the hook URL must NOT, and the param is
    // snake_case vehicle_id — this call shape guards both rules.
    expect(mockedRequest).toHaveBeenCalledWith(
      '/drive-dynamics/latest?vehicle_id=1',
      expect.any(Object),
    )
  })

  it('shows Brake Inactive (not Active/Unknown) when brake_pedal_active is false', async () => {
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
    expect(screen.queryByText('Brake Unknown')).toBeNull()
  })

  it('reads a MISSING brake signal as Unknown (never a confirmed green Inactive) and shows — for the absent gauge', async () => {
    // Only throttle reported — brake position + brake-active are absent.
    mockedRequest.mockResolvedValueOnce({ pedal_position: 33 })

    renderWithClient(<PedalUsage vehicleId={1} />)

    await waitFor(() => {
      expect(screen.getByText('Brake Unknown')).toBeInTheDocument()
    })
    // Panel still renders its gauges (hasAny is true from throttle alone).
    expect(screen.getByText('Throttle Position')).toBeInTheDocument()
    expect(screen.getByText('33')).toBeInTheDocument()
    // Missing brake position renders the em-dash unit, not a bogus "%".
    expect(screen.getByText('—')).toBeInTheDocument()
    // The absent-signal regression: no definitive Active/Inactive claim.
    expect(screen.queryByText('Brake Active')).toBeNull()
    expect(screen.queryByText('Brake Inactive')).toBeNull()
    expect(screen.queryByText('No pedal telemetry received yet')).toBeNull()
  })
})

describe('PedalUsage — empty states', () => {
  it('renders the empty state (no gauges/badges) when the snapshot has no pedal signals', async () => {
    mockedRequest.mockResolvedValueOnce({})

    renderWithClient(<PedalUsage vehicleId={1} />)

    await waitFor(() => {
      expect(screen.getByText('No pedal telemetry received yet')).toBeInTheDocument()
    })
    expect(screen.queryByText('Throttle Position')).toBeNull()
    expect(screen.queryByText('Brake Pedal Position')).toBeNull()
    expect(screen.queryByText('Brake Active')).toBeNull()
    expect(screen.queryByText('Brake Inactive')).toBeNull()
    expect(screen.queryByText('Brake Unknown')).toBeNull()
  })

  it('treats a null snapshot body the same as empty (null-safe optional chaining)', async () => {
    mockedRequest.mockResolvedValueOnce(null)

    renderWithClient(<PedalUsage vehicleId={1} />)

    await waitFor(() => {
      expect(screen.getByText('No pedal telemetry received yet')).toBeInTheDocument()
    })
    expect(screen.queryByText('Throttle Position')).toBeNull()
  })
})

describe('PedalUsage — loading + error states', () => {
  it('shows a gauge skeleton (not the empty state) while the first fetch is in flight', async () => {
    // Never-resolving promise keeps the query in the pending+fetching state.
    mockedRequest.mockReturnValue(new Promise<never>(() => {}))

    renderWithClient(<PedalUsage vehicleId={1} />)

    // Header stays visible and the loading region appears in place of the
    // misleading "no telemetry" empty state.
    expect(screen.getByText('Pedal Usage')).toBeInTheDocument()
    expect(
      await screen.findByRole('status', { name: 'Loading pedal telemetry…' }),
    ).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByText('No pedal telemetry received yet')).toBeNull()
    expect(screen.queryByText('Throttle Position')).toBeNull()
  })

  it('surfaces a QueryError on first-load failure and Retry re-invokes the request', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'))

    renderWithClient(<PedalUsage vehicleId={1} />)

    // Plain Error → network branch (jsdom navigator.onLine defaults true).
    expect(await screen.findByText("Can't reach server")).toBeInTheDocument()
    // Failure is surfaced, not masked as an empty/blank panel.
    expect(screen.queryByText('No pedal telemetry received yet')).toBeNull()
    expect(screen.queryByText('Throttle Position')).toBeNull()

    expect(mockedRequest).toHaveBeenCalledTimes(1)
    const retry = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retry)

    // onRetry → refetch → a second request attempt (failure path exercised).
    await waitFor(() => {
      expect(mockedRequest).toHaveBeenCalledTimes(2)
    })
  })
})

describe('PedalUsage — disabled query guards', () => {
  it('does not query the API when vehicleId is null', async () => {
    renderWithClient(<PedalUsage vehicleId={null} />)

    await waitFor(() => {
      expect(screen.getByText('No pedal telemetry received yet')).toBeInTheDocument()
    })
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('does not query the API when vehicleId is undefined (?? 0 fallback stays disabled)', async () => {
    renderWithClient(<PedalUsage vehicleId={undefined} />)

    await waitFor(() => {
      expect(screen.getByText('No pedal telemetry received yet')).toBeInTheDocument()
    })
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})
