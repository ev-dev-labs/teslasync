import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { HealthProbesSection } from '../HealthProbesSection'
import type { ExtendedHealthResponse } from '@/api/types'

/**
 * HealthProbesSection contract.
 *
 * The section self-fetches `/system/health` via `getExtendedHealth` and must:
 *   - show skeletons while the first probe is in flight,
 *   - render the liveness + readiness readings on success,
 *   - degrade to safe placeholders when nested sections are missing,
 *   - treat a zero latency as a real reading (not "missing"),
 *   - show a retry-able error only on the INITIAL load failure, and
 *   - keep the last good readings visible when a *background* refetch fails.
 */

let mockGetExtendedHealth: ReturnType<typeof vi.fn>

vi.mock('@/api/devtools', () => ({
  getExtendedHealth: (...args: unknown[]) => mockGetExtendedHealth(...args),
}))

// Force the online branch of <QueryError> so the failure surface is the
// role="alert" panel with an enabled "Retry" button (offline would swap to
// role="status" + a disabled control).
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}))

const KEY = ['system-status', 'extended-health'] as const
const EM_DASH = '\u2014'

function makeHealth(overrides: Partial<ExtendedHealthResponse> = {}): ExtendedHealthResponse {
  return {
    status: 'ok',
    components: {},
    database: { status: 'connected', latency_ms: 4.2 },
    database_pool: { total_conns: 12, idle_conns: 8, acquired_conns: 4 },
    system: { goroutines: 148, go_version: 'go1.25.0', uptime_seconds: 93784 },
    ...overrides,
  }
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function renderSection(client = makeClient()) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <HealthProbesSection />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockGetExtendedHealth = vi.fn()
})

describe('HealthProbesSection', () => {
  it('renders skeleton placeholders while the first probe is loading', () => {
    mockGetExtendedHealth.mockReturnValue(new Promise(() => {}))
    const { container } = renderSection()

    expect(screen.getByText('Health Probes')).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(2)
    // The probe cards ("/healthz") must not be present until data resolves.
    expect(screen.queryByText(/healthz/)).toBeNull()
  })

  it('renders liveness + readiness readings once the probe resolves', async () => {
    mockGetExtendedHealth.mockResolvedValue(makeHealth())
    renderSection()

    expect(await screen.findByText(/healthz/)).toBeInTheDocument()
    expect(screen.getByText(/readyz/)).toBeInTheDocument()
    // status is echoed in both the card-header badge and the KV row.
    expect(screen.getAllByText('ok')).toHaveLength(2)
    expect(screen.getAllByText('connected')).toHaveLength(2)
    expect(screen.getByText('148')).toBeInTheDocument() // goroutines
    expect(screen.getByText('1d 2h 3m')).toBeInTheDocument() // uptime of 93784s
    expect(screen.getByText('4.2 ms')).toBeInTheDocument() // db latency
    expect(screen.getByText('12')).toBeInTheDocument() // pool connections
    // header summary chips
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('falls back to safe placeholders when nested probe sections are missing', async () => {
    // A partial / malformed payload: database, system and pool all omitted.
    mockGetExtendedHealth.mockResolvedValue({ status: 'degraded' })
    renderSection()

    expect(await screen.findByText(/readyz/)).toBeInTheDocument()
    // liveness status flows through (header badge + KV row).
    expect(screen.getAllByText('degraded')).toHaveLength(2)
    // database status has no value -> defaults to "unknown" (badge + KV row).
    expect(screen.getAllByText('unknown')).toHaveLength(2)
    // goroutines + pool connections both null-coalesce to 0.
    expect(screen.getAllByText('0')).toHaveLength(2)
    // uptime of 0s formats to "0m"; unknown latency renders an em dash.
    expect(screen.getByText('0m')).toBeInTheDocument()
    expect(screen.getByText(EM_DASH)).toBeInTheDocument()
  })

  it('treats a zero latency as a real reading rather than a missing value', async () => {
    mockGetExtendedHealth.mockResolvedValue(
      makeHealth({ database: { status: 'connected', latency_ms: 0 } }),
    )
    renderSection()

    expect(await screen.findByText('0.0 ms')).toBeInTheDocument()
    // The em-dash placeholder must NOT be used for a genuine 0 ms latency.
    expect(screen.queryByText(EM_DASH)).toBeNull()
  })

  it('shows a retry-able error panel when the initial probe fails', async () => {
    mockGetExtendedHealth.mockRejectedValue(new Error('probe unreachable'))
    renderSection()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    // No stale cards leak through on a clean initial failure.
    expect(screen.queryByText(/healthz/)).toBeNull()

    // Retry re-invokes the query function.
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(mockGetExtendedHealth).toHaveBeenCalledTimes(2))
  })

  it('keeps the last good readings visible when a background refetch fails', async () => {
    const client = makeClient()
    // Seed a prior successful read into the cache.
    client.setQueryData(KEY, makeHealth())
    // The next (background) fetch triggered on mount will fail.
    mockGetExtendedHealth.mockRejectedValue(new Error('transient blip'))

    renderSection(client)

    // Cached readings render immediately.
    expect(screen.getByText(/healthz/)).toBeInTheDocument()

    // The background refetch fails and records an error on the query...
    await waitFor(() => expect(client.getQueryState(KEY)?.error).toBeTruthy())

    // ...but the panel must retain the good data instead of blanking to
    // a full error state (regression guard for the `error && !data` branch).
    expect(screen.getByText(/healthz/)).toBeInTheDocument()
    expect(screen.getByText('148')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
