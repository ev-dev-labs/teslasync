import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { TelemetryPipelineCard } from '../TelemetryPipelineCard'
import type { Vehicle } from '@/api/types'
import type { PollEngineStatus } from '@/api/polling'
import type { TelemetryStatus, VehicleTelemetry } from '@/types/telemetry'

const mockPolling: { data: PollEngineStatus | undefined } = { data: undefined }
const mockMqtt: { data: (TelemetryStatus & { vehicles: VehicleTelemetry[] }) | undefined } = { data: undefined }

vi.mock('@/api/polling', async () => {
  const actual = await vi.importActual<typeof import('@/api/polling')>('@/api/polling')
  return {
    ...actual,
    getPollingStatus: vi.fn(() => Promise.resolve(mockPolling.data)),
  }
})

// Mock the MQTT status hook used by TelemetryPipelineCard. Returning a
// query-shape object keeps the rest of the component happy without
// pulling in TanStack Query internals.
vi.mock('@/api/hooks/useTelemetry', () => ({
  useMQTTStatus: vi.fn(() => ({ data: mockMqtt.data })),
}))

// Only the polling-status `useQuery` call lives inside the component.
// The MQTT status hook is mocked above, so this mock is safe to keep
// returning polling data for every `useQuery` invocation.
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: vi.fn(() => ({ data: mockPolling.data })),
  }
})

const NOW = Date.parse('2025-01-15T12:00:00Z')

function harness(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1,
    vehicle_id: 100001,
    vin: '5YJSA1E60JF000ABC',
    display_name: 'Daily Driver',
    model: 'S',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    timezone: 'UTC',
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

function makeMqtt(
  vehicles: Array<{ vin: string; lastReceivedAgoSec?: number; signalsPerSecond?: number; signalCount?: number }> = [],
  connected = true,
): TelemetryStatus & { vehicles: VehicleTelemetry[] } {
  return {
    connected,
    vehicles: vehicles.map((v) => ({
      vin: v.vin,
      signalCount: v.signalCount ?? 0,
      batchCount: 0,
      signalsPerSecond: v.signalsPerSecond,
      lastReceived: v.lastReceivedAgoSec != null ? new Date(NOW - v.lastReceivedAgoSec * 1000).toISOString() : undefined,
    })),
  }
}

describe('TelemetryPipelineCard', () => {
  beforeEach(() => {
    mockPolling.data = undefined
    mockMqtt.data = undefined
  })

  it('renders the empty state when no vehicles are configured', () => {
    harness(
      <TelemetryPipelineCard
        vehicles={[]}
        positionCount={0}
        drivesCount={0}
        chargingSessionsCount={0}
        signalLogCount={0}
        now={NOW}
      />,
    )
    expect(screen.getByText(/No vehicles configured yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Tesla account/ })).toHaveAttribute('href', '/tesla-account')
  })

  it('renders fleet rollup numbers and per-vehicle row with VIN tail and state', () => {
    const vehicles = [makeVehicle()]
    mockPolling.data = {
      enabled: true,
      vehicles: {
        '5YJSA1E60JF000ABC': {
          activity: 'online',
          profile: 'awake',
          consec_idle: 0,
          last_poll_time: new Date(NOW - 2 * 60_000).toISOString(),
          next_poll_after: new Date(NOW + 30_000).toISOString(),
          battery_level: 73,
          last_decision: null,
        },
      },
    }
    harness(
      <TelemetryPipelineCard
        vehicles={vehicles}
        positionCount={12366}
        drivesCount={4}
        chargingSessionsCount={1}
        signalLogCount={97611}
        now={NOW}
      />,
    )

    expect(screen.getByText('1 connected')).toBeInTheDocument()
    expect(screen.getByText('12,366')).toBeInTheDocument()
    expect(screen.getByText('97,611')).toBeInTheDocument()
    expect(screen.getByText('Daily Driver')).toBeInTheDocument()
    expect(screen.getByText(/VIN ···0ABC/)).toBeInTheDocument()
    expect(screen.getByText('73%')).toBeInTheDocument()
    expect(screen.getByText(/2 min ago/)).toBeInTheDocument()
  })

  it('classifies liveness as sending / slow / stale / offline based on last poll age', () => {
    const vehicles = [
      makeVehicle({ id: 1, vin: 'V1' + 'A'.repeat(15), display_name: 'Fresh' }),
      makeVehicle({ id: 2, vin: 'V2' + 'B'.repeat(15), display_name: 'Slow' }),
      makeVehicle({ id: 3, vin: 'V3' + 'C'.repeat(15), display_name: 'Stale' }),
      makeVehicle({ id: 4, vin: 'V4' + 'D'.repeat(15), display_name: 'Off' }),
    ]
    mockPolling.data = {
      enabled: true,
      vehicles: {
        [vehicles[0].vin]: {
          activity: 'online', profile: 'awake', consec_idle: 0,
          last_poll_time: new Date(NOW - 60_000).toISOString(), // 1 min → sending
          next_poll_after: '', battery_level: 80, last_decision: null,
        },
        [vehicles[1].vin]: {
          activity: 'online', profile: 'awake', consec_idle: 0,
          last_poll_time: new Date(NOW - 10 * 60_000).toISOString(), // 10 min → slow
          next_poll_after: '', battery_level: 50, last_decision: null,
        },
        [vehicles[2].vin]: {
          activity: 'asleep', profile: 'asleep', consec_idle: 5,
          last_poll_time: new Date(NOW - 60 * 60_000).toISOString(), // 60 min → stale
          next_poll_after: '', battery_level: 20, last_decision: null,
        },
        // vehicles[3] has no polling entry → offline
      },
    }
    harness(
      <TelemetryPipelineCard
        vehicles={vehicles}
        positionCount={0}
        drivesCount={0}
        chargingSessionsCount={0}
        signalLogCount={0}
        now={NOW}
      />,
    )
    // Liveness summary chips visible
    expect(screen.getByText(/1 sending/)).toBeInTheDocument()
    expect(screen.getByText(/1 slow/)).toBeInTheDocument()
    expect(screen.getByText(/1 stale/)).toBeInTheDocument()
    expect(screen.getByText(/1 offline/)).toBeInTheDocument()
  })

  it('considers MQTT-stream activity as liveness even when REST polling has never run (the streaming-only Fleet Telemetry case)', () => {
    // This is the exact bug the user hit: vehicle is streaming via Fleet
    // Telemetry → MQTT (fresh `lastReceived`), but the polling engine has
    // no entry. Before the fix, the row rendered "offline · last: —".
    // After the fix, it renders "sending · stream" with the MQTT
    // last-received timestamp.
    const vehicles = [makeVehicle({ display_name: 'Falcon' })]
    mockPolling.data = { enabled: false, vehicles: {} }
    mockMqtt.data = makeMqtt([{ vin: '5YJSA1E60JF000ABC', lastReceivedAgoSec: 12, signalsPerSecond: 0.34, signalCount: 240 }])

    harness(
      <TelemetryPipelineCard
        vehicles={vehicles}
        positionCount={0}
        drivesCount={0}
        chargingSessionsCount={0}
        signalLogCount={0}
        now={NOW}
      />,
    )

    const row = screen.getByText('Falcon').closest('li')!
    // Should be classified as `sending` because the stream is < 5 min old
    expect(within(row).getByText('sending')).toBeInTheDocument()
    // Stream source label appears as a small badge inside the chip
    expect(within(row).getByText('stream')).toBeInTheDocument()
    // Relative time reflects the MQTT timestamp (12 s ago), NOT em-dash
    expect(within(row).getByText(/12s ago/)).toBeInTheDocument()
    // Polling-engine disabled is rendered as informational only (not amber warning)
    expect(screen.getByText(/polling engine off \(streaming-only\)/)).toBeInTheDocument()
    expect(screen.queryByText(/polling engine disabled/)).not.toBeInTheDocument()
  })

  it('uses the most recent timestamp when both stream and poll have data', () => {
    const vehicles = [makeVehicle({ display_name: 'Hybrid' })]
    // Poll happened 3 min ago, stream happened 30 s ago → stream wins
    mockPolling.data = {
      enabled: true,
      vehicles: {
        '5YJSA1E60JF000ABC': {
          activity: 'online', profile: 'awake', consec_idle: 0,
          last_poll_time: new Date(NOW - 3 * 60_000).toISOString(),
          next_poll_after: '', battery_level: 50, last_decision: null,
        },
      },
    }
    mockMqtt.data = makeMqtt([{ vin: '5YJSA1E60JF000ABC', lastReceivedAgoSec: 30 }])

    harness(
      <TelemetryPipelineCard
        vehicles={vehicles}
        positionCount={0}
        drivesCount={0}
        chargingSessionsCount={0}
        signalLogCount={0}
        now={NOW}
      />,
    )

    const row = screen.getByText('Hybrid').closest('li')!
    expect(within(row).getByText('sending')).toBeInTheDocument()
    expect(within(row).getByText('stream')).toBeInTheDocument()
    // The displayed last-seen is the MQTT one (30 s), not the older poll (3 min)
    expect(within(row).getByText(/30s ago/)).toBeInTheDocument()
  })

  it('shows "MQTT broker disconnected" warning chip when broker is down and "polling engine disabled" when both are off', () => {
    mockPolling.data = { enabled: false, vehicles: {} }
    mockMqtt.data = { connected: false, vehicles: [] }
    harness(
      <TelemetryPipelineCard
        vehicles={[makeVehicle()]}
        positionCount={0}
        drivesCount={0}
        chargingSessionsCount={0}
        signalLogCount={0}
        now={NOW}
      />,
    )
    // When MQTT is down AND polling is off, both warnings show
    expect(screen.getByText(/MQTT broker disconnected/)).toBeInTheDocument()
    expect(screen.getByText(/polling engine disabled/)).toBeInTheDocument()
  })

  it('shows "Fleet Telemetry connected" neutral chip when MQTT broker is healthy', () => {
    mockPolling.data = { enabled: true, vehicles: {} }
    mockMqtt.data = makeMqtt([], true)
    harness(
      <TelemetryPipelineCard
        vehicles={[makeVehicle()]}
        positionCount={0}
        drivesCount={0}
        chargingSessionsCount={0}
        signalLogCount={0}
        now={NOW}
      />,
    )
    expect(screen.getByText(/Fleet Telemetry connected/)).toBeInTheDocument()
  })

  it('falls back to em-dash when battery / poll / stream data is missing', () => {
    const vehicles = [makeVehicle()]
    mockPolling.data = { enabled: true, vehicles: {} }
    mockMqtt.data = makeMqtt([])
    harness(
      <TelemetryPipelineCard
        vehicles={vehicles}
        positionCount={0}
        drivesCount={0}
        chargingSessionsCount={undefined}
        signalLogCount={undefined}
        now={NOW}
      />,
    )
    const row = screen.getByText('Daily Driver').closest('li')!
    expect(within(row).getByText(/last: —/)).toBeInTheDocument()
    expect(within(row).getByText('offline')).toBeInTheDocument()
  })

  it('vehicle name links to /vehicles/:id and footer links work', () => {
    const vehicles = [makeVehicle({ id: 42 })]
    mockPolling.data = { enabled: true, vehicles: {} }
    harness(
      <TelemetryPipelineCard
        vehicles={vehicles}
        positionCount={0}
        drivesCount={0}
        chargingSessionsCount={0}
        signalLogCount={0}
        now={NOW}
      />,
    )
    expect(screen.getByRole('link', { name: 'Daily Driver' })).toHaveAttribute('href', '/vehicles/42')
    expect(screen.getByRole('link', { name: /Open Telemetry Coverage/ })).toHaveAttribute('href', '/admin/telemetry/coverage')
    expect(screen.getByRole('link', { name: /MQTT Inspector/ })).toHaveAttribute('href', '/mqtt-inspector')
    expect(screen.getByRole('link', { name: /All vehicles/ })).toHaveAttribute('href', '/vehicles')
  })
})
