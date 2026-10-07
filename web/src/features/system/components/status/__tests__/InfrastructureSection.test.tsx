/**
 * InfrastructureSection tests.
 *
 * The section pulls two independent `useQuery` calls (fleet-telemetry status +
 * extended health) and renders inside a collapsed-by-default accordion. Every
 * branch is exercised deterministically by mocking `@tanstack/react-query`'s
 * `useQuery` and routing by `queryKey[1]` — no QueryClient / async timers, so
 * the 2s `refetchInterval` never fires in the test.
 *
 * Covers:
 *   - honest header badge: loading ("Checking…") / error ("Error") /
 *     connected / disconnected (regression: must NOT claim "Disconnected"
 *     before the first fetch resolves)
 *   - expanded body: SSE + polling cards, endpoint/protocol/speed rows
 *   - polling-fallback branch (mode === 'polling')
 *   - null-safety: empty strings & missing speed_comparison collapse to em-dash
 *   - DB-pool InlineMetrics render independently of telemetry state, and are
 *     omitted when the pool payload is absent
 *   - loading skeleton (role=status/aria-busy) and error alert (role=alert)
 *     replace the cards
 *   - accessibility & interaction: collapsed by default, expands on click AND
 *     keyboard (Enter), decorative icons hidden from assistive tech
 *
 * react-i18next is stubbed to echo keys (mirrors FrontendErrorsCard /
 * TeslaApiUsageCard) so the natural-language `t('…')` strings assert verbatim.
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { TelemetryStatus, ExtendedHealthResponse } from '@/api/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, def?: string) => def ?? key }),
}))

interface QueryState<T> {
  data: T | undefined
  isPending: boolean
  isError: boolean
}

const telemetryQuery: QueryState<TelemetryStatus> = {
  data: undefined,
  isPending: false,
  isError: false,
}
const extHealthQuery: QueryState<ExtendedHealthResponse> = {
  data: undefined,
  isPending: false,
  isError: false,
}

// Route each `useQuery` to its own controllable state via the stable
// second element of the query key (['system-status', 'telemetry' | 'extended-health']).
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query',
  )
  return {
    ...actual,
    useQuery: vi.fn((opts: { queryKey: unknown[] }) => {
      const key = Array.isArray(opts.queryKey) ? opts.queryKey[1] : undefined
      return key === 'extended-health' ? extHealthQuery : telemetryQuery
    }),
  }
})

import { InfrastructureSection } from '../InfrastructureSection'

function makeTelemetry(over: Partial<TelemetryStatus> = {}): TelemetryStatus {
  return {
    enabled: true,
    mode: 'streaming',
    endpoint: 'telemetry.example.com:443',
    protocol: 'grpc',
    supported_signals: [],
    mqtt_publishing: true,
    speed_comparison: {
      fleet_telemetry_latency: '200 ms',
      fleet_api_polling: '15 s',
      speedup: '75x',
    },
    ...over,
  }
}

function makeExtHealth(over: Partial<ExtendedHealthResponse> = {}): ExtendedHealthResponse {
  return {
    status: 'ok',
    components: {
      database: { status: 'ok', latency_ms: 3 },
      database_pool: {
        status: 'healthy',
        total_conns: 30,
        idle_conns: 23,
        acquired_conns: 7,
      },
      system: {
        status: 'healthy',
        goroutines: 42,
        go_version: 'go1.25',
        uptime_seconds: 3600,
      },
    },
    ...over,
  }
}

function setTelemetry(state: Partial<QueryState<TelemetryStatus>>) {
  Object.assign(telemetryQuery, state)
}
function setExtHealth(state: Partial<QueryState<ExtendedHealthResponse>>) {
  Object.assign(extHealthQuery, state)
}

/** Expand the collapsed accordion by activating its header button. */
function expand() {
  fireEvent.click(screen.getByRole('button', { name: /Infrastructure/i }))
}

beforeEach(() => {
  Object.assign(telemetryQuery, { data: undefined, isPending: false, isError: false })
  Object.assign(extHealthQuery, { data: undefined, isPending: false, isError: false })
})

describe('InfrastructureSection — header status badge', () => {
  it('shows a neutral "Checking…" badge (never "Disconnected") while the first fetch is pending', () => {
    setTelemetry({ data: undefined, isPending: true })
    render(<InfrastructureSection />)

    expect(screen.getByText('Checking…')).toBeInTheDocument()
    // Regression guard: the honest loading state must not pre-emptively claim
    // the stream is down.
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
  })

  it('surfaces an "Error" badge and hides Connected/Disconnected when the telemetry query fails', () => {
    setTelemetry({ data: undefined, isError: true })
    render(<InfrastructureSection />)

    expect(screen.getByText('Error')).toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    expect(screen.queryByText('Disconnected')).not.toBeInTheDocument()
  })

  it('shows "Connected" when streaming is enabled and "Disconnected" when it is not', () => {
    setTelemetry({ data: makeTelemetry({ enabled: true }) })
    const { unmount } = render(<InfrastructureSection />)
    // Collapsed by default → the only occurrence is the header badge.
    expect(screen.getByText('Connected')).toBeInTheDocument()
    unmount()

    setTelemetry({ data: makeTelemetry({ enabled: false }) })
    render(<InfrastructureSection />)
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
  })
})

describe('InfrastructureSection — loading & error body', () => {
  it('renders a busy skeleton region instead of the cards while loading', () => {
    setTelemetry({ data: undefined, isPending: true })
    render(<InfrastructureSection />)
    expand()

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveAttribute('aria-label', 'Loading infrastructure diagnostics')
    // Cards must not render in the loading branch.
    expect(screen.queryByText('SSE Connection')).not.toBeInTheDocument()
    expect(screen.queryByText('Polling Engine')).not.toBeInTheDocument()
  })

  it('renders an alert instead of the cards when the query errors', () => {
    setTelemetry({ data: undefined, isError: true })
    render(<InfrastructureSection />)
    expand()

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Unable to load infrastructure diagnostics.')
    expect(screen.queryByText('SSE Connection')).not.toBeInTheDocument()
  })
})

describe('InfrastructureSection — expanded content', () => {
  it('renders the SSE + polling cards with endpoint, protocol, and speed comparison', () => {
    setTelemetry({ data: makeTelemetry() })
    render(<InfrastructureSection />)
    expand()

    expect(screen.getByText('SSE Connection')).toBeInTheDocument()
    expect(screen.getByText('Polling Engine')).toBeInTheDocument()
    expect(screen.getByText('telemetry.example.com:443')).toBeInTheDocument()
    expect(screen.getByText('grpc')).toBeInTheDocument()
    expect(screen.getByText('75x')).toBeInTheDocument()
    expect(screen.getByText('200 ms')).toBeInTheDocument()
    expect(screen.getByText('15 s')).toBeInTheDocument()
    // streaming mode → not a polling fallback
    expect(screen.getByText('No')).toBeInTheDocument()
    expect(screen.getByText('streaming')).toBeInTheDocument()
    // polling engine idle while streaming
    expect(screen.getByText('Standby')).toBeInTheDocument()
  })

  it('reflects the polling-fallback branch when mode === "polling"', () => {
    setTelemetry({ data: makeTelemetry({ enabled: false, mode: 'polling' }) })
    render(<InfrastructureSection />)
    expand()

    expect(screen.getByText('Yes — Polling')).toBeInTheDocument()
    // Polling engine badge flips to Active; standby text must be gone.
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('Standby')).not.toBeInTheDocument()
    expect(screen.getByText('polling')).toBeInTheDocument()
  })

  it('collapses empty strings and missing speed_comparison to em-dashes', () => {
    setTelemetry({
      data: makeTelemetry({
        endpoint: '',
        protocol: '',
        mode: '',
        speed_comparison: undefined,
      }),
    })
    render(<InfrastructureSection />)
    expand()

    // endpoint, protocol, mode, speedup, latency, api-polling → six em-dashes.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(6)
    // Empty mode is not "polling" → Fallback Mode stays "No".
    expect(screen.getByText('No')).toBeInTheDocument()
  })
})

describe('InfrastructureSection — database pool metrics', () => {
  it('renders locale-formatted pool metrics when the payload is present', () => {
    setTelemetry({ data: makeTelemetry() })
    setExtHealth({ data: makeExtHealth() })
    render(<InfrastructureSection />)
    expand()

    expect(screen.getByText('Total Conns')).toBeInTheDocument()
    expect(screen.getByText('Acquired')).toBeInTheDocument()
    expect(screen.getByText('Idle')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('23')).toBeInTheDocument()
  })

  it('omits the pool section entirely when database_pool is absent', () => {
    setTelemetry({ data: makeTelemetry() })
    setExtHealth({ data: undefined })
    render(<InfrastructureSection />)
    expand()

    expect(screen.queryByText('Total Conns')).not.toBeInTheDocument()
    expect(screen.queryByText('Acquired')).not.toBeInTheDocument()
    expect(screen.queryByText('Idle')).not.toBeInTheDocument()
  })

  it('renders pool metrics even while telemetry itself is still loading', () => {
    setTelemetry({ data: undefined, isPending: true })
    setExtHealth({ data: makeExtHealth() })
    render(<InfrastructureSection />)
    expand()

    // Telemetry cards are behind the loading skeleton, but the independent
    // pool query still surfaces its metrics.
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Total Conns')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
  })
})

describe('InfrastructureSection — accessibility & interaction', () => {
  it('is collapsed by default and reveals the body on click', () => {
    setTelemetry({ data: makeTelemetry() })
    render(<InfrastructureSection />)

    // Body hidden until the header is activated.
    expect(screen.queryByText('SSE Connection')).not.toBeInTheDocument()
    const header = screen.getByRole('button', { name: /Infrastructure/i })
    expect(header).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('SSE Connection')).toBeInTheDocument()
  })

  it('is keyboard-operable — Enter on the header toggles it open', () => {
    setTelemetry({ data: makeTelemetry() })
    render(<InfrastructureSection />)

    const header = screen.getByRole('button', { name: /Infrastructure/i })
    fireEvent.keyDown(header, { key: 'Enter' })

    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Polling Engine')).toBeInTheDocument()
  })

  it('marks its decorative icons aria-hidden so assistive tech ignores them', () => {
    setTelemetry({ data: makeTelemetry() })
    setExtHealth({ data: makeExtHealth() })
    const { container } = render(<InfrastructureSection />)

    // The always-visible section icon (Globe) is decorative.
    const header = screen.getByRole('button', { name: /Infrastructure/i })
    expect(header.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(1)

    fireEvent.click(header)
    // Globe + Wifi + Database + Activity + Clock are all hidden from AT; none
    // of this section's own icons should be exposed as a named graphic.
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(5)
  })
})
