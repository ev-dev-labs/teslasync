import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { ServiceHealthSection } from '../ServiceHealthSection'
import type { TelemetryStatus } from '@/api/types'

/**
 * ServiceHealthSection is a collapsible accordion that polls the Fleet
 * Telemetry status endpoint every 2s and fans it into always-visible header
 * badges (enabled + streaming count) plus a body of metric cards and a
 * per-vehicle streaming table.
 *
 * These tests exercise every branch: the collapsed→expanded interaction, the
 * header badges (enabled/disabled + streaming subset), the loading skeleton,
 * the success render (metric cards + vehicle table column renders), the
 * table's empty state, the null-data placeholder, the aggregate-stats
 * null-safety fallbacks, and the error/retry path. The final case is a
 * regression guard for the hardening fix: a *background* poll failure must
 * keep the last-good telemetry on screen instead of flapping the whole panel
 * to a full-width error.
 */

const telemetryMock = vi.fn()

vi.mock('@/api/devtools', () => ({
  getTelemetryStatus: () => telemetryMock(),
}))

// QueryError branches on connectivity. Pin the browser online so a failed
// request renders the assertive, retryable "can't reach server" alert
// deterministically in jsdom (rather than the polite offline placeholder
// with a disabled CTA).
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}))

type StreamingVehicle = TelemetryStatus['streaming_vehicles'][string]

let vinSeq = 0
function makeVehicle(overrides: Partial<StreamingVehicle> = {}): StreamingVehicle {
  vinSeq += 1
  return {
    vin: `5YJ3E1EA1KF00000${vinSeq}`,
    last_received: '2025-01-15T12:00:00Z',
    first_received: '2025-01-15T10:00:00Z',
    signal_count: 12_345,
    batch_count: 100,
    is_streaming: true,
    data_source: 'fleet_telemetry',
    signals_per_second: 4.5,
    latency_ms: 120,
    uptime_seconds: 3_600,
    ...overrides,
  }
}

function makeStatus(overrides: Partial<TelemetryStatus> = {}): TelemetryStatus {
  return {
    enabled: true,
    mode: 'fleet_telemetry',
    endpoint: 'wss://telemetry.example',
    protocol: 'mqtt',
    supported_signals: ['VehicleSpeed'],
    mqtt_publishing: true,
    aggregate_stats: {
      streaming_vehicles: 1,
      total_vehicles_seen: 2,
      total_signals_received: 1_000_000,
      total_batches_processed: 500,
      avg_signals_per_second: '12.5',
      stale_timeout: '5m',
    },
    streaming_vehicles: {},
    ...overrides,
  }
}

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ServiceHealthSection />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...utils, client }
}

function header(): HTMLElement {
  return screen.getByRole('button', { name: /Service Health/i })
}

/** Resolve a MetricCard's inner column from its label so its value can be
 *  asserted in isolation (several cards share the digit "0"). */
function metricCard(label: string): HTMLElement {
  const box = screen.getByText(label).closest('.flex-1')
  if (!(box instanceof HTMLElement)) throw new Error(`metric card not found for "${label}"`)
  return box
}

beforeEach(() => {
  telemetryMock.mockReset()
  vinSeq = 0
})

describe('ServiceHealthSection', () => {
  it('is collapsed by default and reveals the telemetry body when expanded', async () => {
    telemetryMock.mockResolvedValue(makeStatus({ streaming_vehicles: { a: makeVehicle() } }))
    renderSection()

    const btn = header()
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Mode')).not.toBeInTheDocument()

    fireEvent.click(btn)

    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText('Mode')).toBeInTheDocument()
  })

  it('surfaces the enabled state and streaming subset as always-visible header badges', async () => {
    telemetryMock.mockResolvedValue(
      makeStatus({
        enabled: true,
        streaming_vehicles: {
          a: makeVehicle({ is_streaming: true }),
          b: makeVehicle({ is_streaming: false }),
          c: makeVehicle({ is_streaming: true }),
        },
      }),
    )
    renderSection()

    // Badges live in the collapsed header — no expand required.
    expect(await screen.findByText('Enabled')).toBeInTheDocument()
    // 2 of the 3 vehicles report is_streaming.
    expect(screen.getByText(/2 streaming/i)).toBeInTheDocument()
    // Body stays collapsed until the header is activated.
    expect(screen.queryByText('Mode')).not.toBeInTheDocument()
  })

  it('renders a "Disabled" badge and a zero streaming count when telemetry is off', async () => {
    telemetryMock.mockResolvedValue(makeStatus({ enabled: false, streaming_vehicles: {} }))
    renderSection()

    expect(await screen.findByText('Disabled')).toBeInTheDocument()
    expect(screen.getByText(/0 streaming/i)).toBeInTheDocument()
    expect(screen.queryByText('Enabled')).not.toBeInTheDocument()
  })

  it('shows a loading skeleton (and no metrics) while the query is pending', async () => {
    telemetryMock.mockReturnValue(new Promise<TelemetryStatus>(() => {}))
    const { container } = renderSection()

    // Nothing renders in the collapsed body yet.
    expect(container.querySelector('.animate-pulse')).toBeNull()

    fireEvent.click(header())

    await waitFor(() => expect(container.querySelector('.animate-pulse')).not.toBeNull())
    expect(screen.queryByText('Mode')).not.toBeInTheDocument()
  })

  it('renders metric cards and the per-vehicle streaming table on success', async () => {
    telemetryMock.mockResolvedValue(
      makeStatus({
        mode: 'fleet_telemetry',
        aggregate_stats: {
          streaming_vehicles: 1,
          total_vehicles_seen: 2,
          total_signals_received: 1_000_000,
          total_batches_processed: 10,
          avg_signals_per_second: '12.5',
          stale_timeout: '5m',
        },
        streaming_vehicles: {
          a: makeVehicle({ vin: 'VINAAA111', is_streaming: true, signal_count: 12_345 }),
          b: makeVehicle({ vin: 'VINBBB222', is_streaming: false, signal_count: 6_789 }),
        },
      }),
    )
    renderSection()
    fireEvent.click(header())

    expect(await screen.findByText('Mode')).toBeInTheDocument()

    // Metric values scoped to their own card.
    expect(within(metricCard('Mode')).getByText('fleet_telemetry')).toBeInTheDocument()
    // 1 of 2 vehicles is streaming.
    expect(within(metricCard('Vehicles Connected')).getByText('1')).toBeInTheDocument()
    expect(within(metricCard('Total Signals')).getByText('1,000,000')).toBeInTheDocument()
    expect(within(metricCard('Avg Signals/s')).getByText('12.5')).toBeInTheDocument()

    // The vehicle table renders both rows with formatted cells.
    const table = screen.getByRole('table')
    expect(within(table).getByText('VINAAA111')).toBeInTheDocument()
    expect(within(table).getByText('VINBBB222')).toBeInTheDocument()
    expect(within(table).getByText('12,345')).toBeInTheDocument()
    expect(within(table).getByText('6,789')).toBeInTheDocument()
    // Status badges branch on is_streaming.
    expect(within(table).getByText('Streaming')).toBeInTheDocument()
    expect(within(table).getByText('Idle')).toBeInTheDocument()
  })

  it('keeps the metric cards visible and shows an empty table when no vehicles stream', async () => {
    telemetryMock.mockResolvedValue(makeStatus({ streaming_vehicles: {} }))
    renderSection()
    fireEvent.click(header())

    expect(await screen.findByText('Mode')).toBeInTheDocument()
    // Panel is never hidden — the metric cards still render...
    expect(screen.getByText('Total Signals')).toBeInTheDocument()
    expect(within(metricCard('Vehicles Connected')).getByText('0')).toBeInTheDocument()
    // ...and the table surfaces its empty message instead of rows.
    expect(screen.getByText('No vehicles connected')).toBeInTheDocument()
  })

  it('shows the empty placeholder when the endpoint returns no telemetry payload', async () => {
    telemetryMock.mockResolvedValue(null as unknown as TelemetryStatus)
    renderSection()
    fireEvent.click(header())

    expect(await screen.findByText('Telemetry service health has not reported yet.')).toBeInTheDocument()
    expect(screen.getByText(/signal throughput appear after the telemetry service/)).toBeInTheDocument()
    expect(screen.queryByText('Mode')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('falls back to zero aggregates instead of crashing when aggregate_stats is missing', async () => {
    telemetryMock.mockResolvedValue(
      makeStatus({ aggregate_stats: undefined, streaming_vehicles: {} }),
    )
    renderSection()
    fireEvent.click(header())

    expect(await screen.findByText('Total Signals')).toBeInTheDocument()
    expect(within(metricCard('Total Signals')).getByText('0')).toBeInTheDocument()
    expect(within(metricCard('Avg Signals/s')).getByText('0')).toBeInTheDocument()
  })

  it('surfaces a retryable error on a cold failure, then recovers when retried', async () => {
    telemetryMock
      .mockRejectedValueOnce(new Error('telemetry offline'))
      .mockResolvedValue(makeStatus({ streaming_vehicles: { a: makeVehicle() } }))
    renderSection()
    fireEvent.click(header())

    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()

    const retry = screen.getByRole('button', { name: /retry/i })
    fireEvent.click(retry)

    expect(await screen.findByText('Mode')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps stale telemetry visible when a background poll fails (no error flap)', async () => {
    telemetryMock
      .mockResolvedValueOnce(makeStatus({ streaming_vehicles: { a: makeVehicle() } }))
      .mockRejectedValue(new Error('poll blip'))
    const { client } = renderSection()
    fireEvent.click(header())

    expect(await screen.findByText('Mode')).toBeInTheDocument()

    // Force the background refetch that rejects — react-query retains the
    // last-good data while flipping `error` on.
    await act(async () => {
      await client
        .refetchQueries({ queryKey: ['system-status', 'telemetry'] })
        .catch(() => {})
    })

    expect(telemetryMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    // Stale content stays; the panel does NOT collapse into a full error.
    expect(screen.getByText('Mode')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
