import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { TelemetryPipelineCard } from '../TelemetryPipelineCard'
import type { Vehicle } from '@/api/types'
import type { PollEngineStatus } from '@/api/polling'

const mockPolling: { data: PollEngineStatus | undefined } = { data: undefined }

vi.mock('@/api/polling', async () => {
  const actual = await vi.importActual<typeof import('@/api/polling')>('@/api/polling')
  return {
    ...actual,
    getPollingStatus: vi.fn(() => Promise.resolve(mockPolling.data)),
  }
})

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

describe('TelemetryPipelineCard', () => {
  beforeEach(() => {
    mockPolling.data = undefined
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

  it('shows "polling engine disabled" warning chip when enabled is false', () => {
    mockPolling.data = { enabled: false, vehicles: {} }
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
    expect(screen.getByText(/polling engine disabled/)).toBeInTheDocument()
  })

  it('falls back to em-dash when battery / poll data is missing', () => {
    const vehicles = [makeVehicle()]
    mockPolling.data = { enabled: true, vehicles: {} }
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
    // Per-vehicle row shows last: — and offline chip
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
    expect(screen.getByRole('link', { name: /All vehicles/ })).toHaveAttribute('href', '/vehicles')
  })
})
