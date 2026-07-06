/**
 * GForcePanel — behaviour + hardening contract.
 *
 * GForcePanel projects LateralAcceleration + LongitudinalAcceleration
 * from /drive-dynamics/latest (signal.LiveStateReader.LiveState) into a
 * 3-up StatCard panel (lateral / longitudinal / combined magnitude).
 *
 * These tests pin every facet of the component:
 *   - the combined magnitude is the Pythagorean vector length of the two
 *     axes (√(lat² + lon²)), NOT a raw axis value, and stays correct with
 *     a negative (braking) longitudinal component;
 *   - a partially-reported snapshot (only one axis) renders that axis and
 *     shows "—" for both the missing axis AND the combined magnitude,
 *     because a missing axis is unknown rather than zero;
 *   - an empty snapshot renders the empty state and NO stat cards;
 *   - a null/undefined vehicleId gates the query entirely (no request);
 *   - the first load shows skeletons — distinct from the empty state —
 *     then swaps to values;
 *   - a transport failure surfaces a QueryError (role="alert"), NOT the
 *     "no telemetry received" empty state (the historical bug where a
 *     dead route masqueraded as "no data"), and the Retry control
 *     refetches and recovers;
 *   - the endpoint is the SI /drive-dynamics/latest route with a
 *     snake_case vehicle_id param and no /api/v1 double prefix.
 *
 * The shared `request` helper is mocked so the real `useQuery` runs
 * end-to-end without a network; i18n is stubbed to fall back to the
 * `defaultValue`/fallback argument (matches the sibling panel tests).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

// Preserve the real module (QueryError reaches for isApiError) and only
// swap the network primitive so the real useQuery runs offline.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return {
    ...actual,
    request: vi.fn(),
  }
})

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

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

function renderPanel(ui: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  )
}

// StatCard renders the label and value in two SIBLING divs inside a Card
// root, so `label.parentElement` is the label-row only — the value lives
// one level up. Walk to the Card root to read the whole "label+value+unit"
// text for a specific card. (Same helper the sibling AutopilotSection
// test relies on.)
function statCardText(labelEl: HTMLElement): string {
  return labelEl.parentElement?.parentElement?.textContent ?? ''
}

beforeEach(() => {
  mockedRequest.mockReset()
})

describe('GForcePanel — values + combined magnitude', () => {
  it('renders lateral, longitudinal, and the Pythagorean combined magnitude', async () => {
    // 0.3 / 0.4 is a clean 3-4-5 triangle → combined magnitude 0.5g.
    // A NEGATIVE longitudinal (braking) proves the magnitude squares the
    // component rather than summing signed values.
    mockedRequest.mockResolvedValueOnce({
      lateral_acceleration: 0.3,
      longitudinal_acceleration: -0.4,
    })

    renderPanel(<GForcePanel vehicleId={1} />)

    // The header is always present.
    expect(
      screen.getByRole('heading', { name: /acceleration g-force/i }),
    ).toBeInTheDocument()

    const lateralLabel = await screen.findByText('Lateral')
    expect(statCardText(lateralLabel)).toContain('0.30')

    expect(statCardText(screen.getByText('Longitudinal'))).toContain('-0.40')

    // Combined = √(0.3² + 0.4²) = 0.50 — NOT a raw axis value.
    const combinedText = statCardText(screen.getByText('Combined'))
    expect(combinedText).toContain('0.50')
    expect(combinedText).not.toContain('0.30')
    expect(combinedText).not.toContain('0.40')

    // Empty state must be gone; endpoint is the SI route with a
    // snake_case param and no /api/v1 prefix.
    expect(screen.queryByText('No G-force telemetry received yet')).toBeNull()
    expect(mockedRequest).toHaveBeenCalledWith(
      '/drive-dynamics/latest?vehicle_id=1',
      expect.any(Object),
    )
  })

  it('shows "—" for the missing axis AND the combined magnitude when only lateral is reported', async () => {
    mockedRequest.mockResolvedValueOnce({ lateral_acceleration: 0.25 })

    renderPanel(<GForcePanel vehicleId={1} />)

    const lateralLabel = await screen.findByText('Lateral')
    expect(statCardText(lateralLabel)).toContain('0.25')
    // Missing longitudinal is unknown, not zero → em-dash, and the
    // combined magnitude cannot be computed → em-dash (never "0.25").
    expect(statCardText(screen.getByText('Longitudinal'))).toContain('—')
    const combinedText = statCardText(screen.getByText('Combined'))
    expect(combinedText).toContain('—')
    expect(combinedText).not.toContain('0.25')
    // Panel is populated, not empty.
    expect(screen.queryByText('No G-force telemetry received yet')).toBeNull()
  })

  it('shows "—" for the missing axis AND the combined magnitude when only longitudinal is reported', async () => {
    mockedRequest.mockResolvedValueOnce({ longitudinal_acceleration: 0.18 })

    renderPanel(<GForcePanel vehicleId={1} />)

    const longitudinalLabel = await screen.findByText('Longitudinal')
    expect(statCardText(longitudinalLabel)).toContain('0.18')
    expect(statCardText(screen.getByText('Lateral'))).toContain('—')
    expect(statCardText(screen.getByText('Combined'))).toContain('—')
  })

  it('ignores non-finite axis values (NaN / Infinity) rather than rendering them', async () => {
    // typeof NaN === 'number' would slip past a naive guard and produce a
    // NaN combined magnitude; isFiniteNumber rejects it, so the panel
    // treats the snapshot as having no usable G-force and falls back to
    // the empty state.
    mockedRequest.mockResolvedValueOnce({
      lateral_acceleration: Number.NaN,
      longitudinal_acceleration: Number.POSITIVE_INFINITY,
    })

    renderPanel(<GForcePanel vehicleId={1} />)

    await waitFor(() => {
      expect(
        screen.getByText('No G-force telemetry received yet'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('Lateral')).toBeNull()
    expect(screen.queryByText('Combined')).toBeNull()
  })
})

describe('GForcePanel — empty + disabled states', () => {
  it('renders the empty state and no stat cards when the snapshot has no G-force signals', async () => {
    mockedRequest.mockResolvedValueOnce({})

    renderPanel(<GForcePanel vehicleId={1} />)

    await waitFor(() => {
      expect(
        screen.getByText('No G-force telemetry received yet'),
      ).toBeInTheDocument()
    })
    expect(screen.queryByText('Lateral')).toBeNull()
    expect(screen.queryByText('Longitudinal')).toBeNull()
    expect(screen.queryByText('Combined')).toBeNull()
  })

  it('does not query the API when vehicleId is null', async () => {
    renderPanel(<GForcePanel vehicleId={null} />)

    await waitFor(() => {
      expect(
        screen.getByText('No G-force telemetry received yet'),
      ).toBeInTheDocument()
    })
    expect(mockedRequest).not.toHaveBeenCalled()
  })

  it('does not query the API when vehicleId is undefined', async () => {
    renderPanel(<GForcePanel vehicleId={undefined} />)

    await waitFor(() => {
      expect(
        screen.getByText('No G-force telemetry received yet'),
      ).toBeInTheDocument()
    })
    expect(mockedRequest).not.toHaveBeenCalled()
  })
})

describe('GForcePanel — loading + error states', () => {
  it('shows loading skeletons (distinct from the empty state) before data arrives, then the values', async () => {
    // Hold the request open so the panel stays in its loading state,
    // then resolve to assert the transition.
    let resolveRequest!: (value: unknown) => void
    mockedRequest.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRequest = resolve
      }),
    )

    const { container } = renderPanel(<GForcePanel vehicleId={1} />)

    // Loading: header is present, at least one skeleton is rendered, and
    // crucially the panel is NOT showing the empty state or any value —
    // loading must never be mistaken for "no telemetry".
    expect(
      screen.getByRole('heading', { name: /acceleration g-force/i }),
    ).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    expect(screen.queryByText('Lateral')).toBeNull()
    expect(screen.queryByText('No G-force telemetry received yet')).toBeNull()

    resolveRequest({ lateral_acceleration: 0.3, longitudinal_acceleration: -0.4 })

    const lateralLabel = await screen.findByText('Lateral')
    expect(statCardText(lateralLabel)).toContain('0.30')
    expect(statCardText(screen.getByText('Combined'))).toContain('0.50')
  })

  it('surfaces a QueryError (not the empty state) on failure and recovers via Retry', async () => {
    // First load fails; the Retry click refetches and succeeds.
    mockedRequest
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        lateral_acceleration: 0.3,
        longitudinal_acceleration: -0.4,
      })

    renderPanel(<GForcePanel vehicleId={1} />)

    // A transport failure must render an alert, NOT the misleading
    // "no telemetry received yet" empty state.
    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(screen.getByText("Can't reach server")).toBeInTheDocument()
    expect(screen.queryByText('No G-force telemetry received yet')).toBeNull()
    expect(screen.queryByText('Lateral')).toBeNull()

    // Retry re-runs the query; on success the panel recovers to values.
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))

    const lateralLabel = await screen.findByText('Lateral')
    expect(statCardText(lateralLabel)).toContain('0.30')
    expect(statCardText(screen.getByText('Combined'))).toContain('0.50')
    expect(mockedRequest).toHaveBeenCalledTimes(2)
  })
})
