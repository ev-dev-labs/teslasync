import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { BackendStatusSection } from '../BackendStatusSection'
import type { ExtendedHealthResponse, VersionInfo } from '@/api/types'
import type { ConnectionPool } from '@/types/admin'

// The section pulls from three independent data sources:
//   1. getExtendedHealth() via a bare useQuery   (component table + runtime)
//   2. useConnectionPool()                        (DB pool stat cards)
//   3. getVersionInfo() via a bare useQuery       (runtime overrides)
// We mock the two devtools fetchers and the pool hook at the module boundary
// (mirroring the TelemetryPipelineCard test convention — `@testing-library/
// user-event` is not installed in this repo, so interactions use fireEvent),
// then drive the real useQuery instances through a QueryClientProvider so the
// loading / error / success branches all exercise production code paths.
type Mode = 'resolve' | 'reject' | 'pending'

const mockExtHealth: { value?: ExtendedHealthResponse; mode: Mode } = { value: undefined, mode: 'pending' }
const mockVersion: { value?: VersionInfo; mode: Mode } = { value: undefined, mode: 'pending' }
const mockPool: { data?: ConnectionPool; isLoading: boolean } = { data: undefined, isLoading: false }

vi.mock('@/api/devtools', () => ({
  getExtendedHealth: vi.fn(() => {
    if (mockExtHealth.mode === 'pending') return new Promise<ExtendedHealthResponse>(() => {})
    if (mockExtHealth.mode === 'reject') return Promise.reject(new Error('health failed'))
    return Promise.resolve(mockExtHealth.value as ExtendedHealthResponse)
  }),
  getVersionInfo: vi.fn(() => {
    if (mockVersion.mode === 'pending') return new Promise<VersionInfo>(() => {})
    if (mockVersion.mode === 'reject') return Promise.reject(new Error('version failed'))
    return Promise.resolve(mockVersion.value as VersionInfo)
  }),
}))

vi.mock('@/api/hooks/useAdmin', () => ({
  useConnectionPool: vi.fn(() => ({ data: mockPool.data, isLoading: mockPool.isLoading })),
}))

function makeExtHealth(overrides: Partial<ExtendedHealthResponse> = {}): ExtendedHealthResponse {
  return {
    status: 'ok',
    components: {
      database: { status: 'healthy', latency_ms: 12.5, last_check: '2025-06-15T12:00:00Z', consecutive_failures: 0 },
      redis: { status: 'healthy', latency_ms: 3.2, last_check: '', consecutive_failures: 0 },
      database_pool: {
        status: 'healthy',
        total_conns: 10,
        idle_conns: 5,
        acquired_conns: 5,
      },
      system: {
        status: 'healthy',
        goroutines: 137,
        go_version: 'go1.24.0',
        uptime_seconds: 93784,
      },
    },
    ...overrides,
  }
}

function makePool(overrides: Partial<ConnectionPool> = {}): ConnectionPool {
  return { maxOpen: 100, open: 42, inUse: 17, idle: 25, waitCount: 9, waitDurationMs: 0, ...overrides }
}

function makeVersion(overrides: Partial<VersionInfo> = {}): VersionInfo {
  return {
    app_version: '1.0.0',
    chart_version: '1.0.0',
    go_version: 'go1.25.1',
    os: 'linux',
    arch: 'amd64',
    uptime_seconds: 93784,
    goroutines: 137,
    ...overrides,
  }
}

function harness() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BackendStatusSection />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('BackendStatusSection', () => {
  beforeEach(() => {
    mockExtHealth.value = undefined
    mockExtHealth.mode = 'pending'
    mockVersion.value = undefined
    mockVersion.mode = 'pending'
    mockPool.data = undefined
    mockPool.isLoading = false
  })

  it('renders skeletons (not the panels) while backend health is loading', () => {
    // Extended-health query stays pending → isLoading is true.
    mockPool.isLoading = true
    const { container } = harness()

    // The accordion header always renders; the body is skeletons only.
    expect(screen.getByText('Backend Status')).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('Component Health')).not.toBeInTheDocument()
    expect(screen.queryByText('Database Connection Pool')).not.toBeInTheDocument()
  })

  it('renders every panel for a fully-healthy fleet and prefers version info over extHealth.system', async () => {
    mockExtHealth.value = makeExtHealth()
    mockExtHealth.mode = 'resolve'
    mockVersion.value = makeVersion()
    mockVersion.mode = 'resolve'
    mockPool.data = makePool()

    const { container } = harness()

    // Component health table with all five headers.
    expect(await screen.findByText('Component Health')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Component' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Latency' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Failures' })).toBeInTheDocument()

    // Per-component rows.
    expect(screen.getByText('database')).toBeInTheDocument()
    expect(screen.getByText('redis')).toBeInTheDocument()
    expect(screen.getAllByText('healthy')).toHaveLength(4)
    expect(screen.getByText('12.5 ms')).toBeInTheDocument()
    expect(screen.getByText('3.2 ms')).toBeInTheDocument()
    // database has a last_check timestamp (year renders), redis falls back to em-dash.
    expect(container.textContent).toContain('2025')

    // Roll-up badge: all healthy → success variant.
    const badge = screen.getByText(/^4\/4 healthy$/)
    expect(badge).toHaveClass('bg-green-100')

    // DB connection pool stat cards.
    expect(screen.getByText('Database Connection Pool')).toBeInTheDocument()
    for (const label of ['Max Open', 'Open', 'In Use', 'Idle', 'Wait Count']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()

    // System runtime: version wins over extHealth.components.system for go_version.
    expect(await screen.findByText('go1.25.1')).toBeInTheDocument()
    expect(screen.queryByText('go1.24.0')).not.toBeInTheDocument()
    expect(screen.getByText('1d 2h 3m')).toBeInTheDocument()
    expect(screen.getByText('137')).toBeInTheDocument()
    expect(screen.getByText('linux / amd64')).toBeInTheDocument()
  })

  it('shows a warning badge and highlights failing components when the fleet is degraded', async () => {
    mockExtHealth.value = makeExtHealth({
      components: {
        database: { status: 'healthy', latency_ms: 5, last_check: '', consecutive_failures: 0 },
        mqtt: { status: 'unhealthy', latency_ms: 250, last_check: '', consecutive_failures: 4 },
      },
    })
    mockExtHealth.mode = 'resolve'
    mockVersion.value = makeVersion()
    mockVersion.mode = 'resolve'
    mockPool.data = makePool()

    harness()

    expect(await screen.findByText('Component Health')).toBeInTheDocument()

    // Partial health → warning variant with the correct count.
    const badge = screen.getByText(/^1\/2 healthy$/)
    expect(badge).toHaveClass('bg-yellow-100')

    // Status text colour comes from statusTextClass().
    expect(screen.getByText('unhealthy')).toHaveClass('text-red-400')
    expect(screen.getByText('healthy')).toHaveClass('text-green-400')

    // Non-zero failure count is highlighted red.
    const failures = screen.getByText('4')
    expect(failures).toHaveClass('text-red-400')

    expect(screen.getByText('250.0 ms')).toBeInTheDocument()
    expect(screen.getByText('5.0 ms')).toBeInTheDocument()
  })

  it('falls back to extHealth.components.system when the version endpoint fails, and shows em-dash for OS/Arch', async () => {
    mockExtHealth.value = makeExtHealth()
    mockExtHealth.mode = 'resolve'
    mockVersion.mode = 'reject' // version query errors → version is undefined
    mockPool.data = makePool()

    harness()

    expect(await screen.findByText('Component Health')).toBeInTheDocument()
    // Go version falls back to extHealth.components.system.go_version.
    expect(await screen.findByText('go1.24.0')).toBeInTheDocument()
    // Uptime + goroutines also come from extHealth.components.system.
    expect(screen.getByText('1d 2h 3m')).toBeInTheDocument()
    expect(screen.getByText('137')).toBeInTheDocument()
    // OS / Arch has no extHealth fallback → em-dash placeholder.
    const osRow = screen.getByText('OS / Arch').closest('div') as HTMLElement
    expect(within(osRow).getByText('—')).toBeInTheDocument()
  })

  it('renders the empty-table state and no roll-up badge when there are zero components', async () => {
    mockExtHealth.value = makeExtHealth({ components: {} })
    mockExtHealth.mode = 'resolve'
    mockVersion.value = makeVersion()
    mockVersion.mode = 'resolve'
    mockPool.data = makePool()

    harness()

    expect(await screen.findByText('No components found')).toBeInTheDocument()
    // No components → the header carries no "N/N healthy" badge.
    expect(screen.queryByText(/^\d+\/\d+ healthy$/)).not.toBeInTheDocument()
    // Pool section still renders independently.
    expect(screen.getByText('Database Connection Pool')).toBeInTheDocument()
  })

  it('does not crash when the health payload omits the components map (null-safety guard)', async () => {
    // Regression guard: Object.entries(undefined) would throw. The source must
    // coalesce the missing map to {} and render the empty table instead.
    mockExtHealth.value = makeExtHealth({
      components: undefined as unknown as ExtendedHealthResponse['components'],
    })
    mockExtHealth.mode = 'resolve'
    mockVersion.value = makeVersion()
    mockVersion.mode = 'resolve'
    mockPool.data = makePool()

    harness()

    expect(await screen.findByText('No components found')).toBeInTheDocument()
    expect(screen.getByText('Backend Status')).toBeInTheDocument()
  })

  it('surfaces an error banner and empty table when the health endpoint fails', async () => {
    mockExtHealth.mode = 'reject'
    mockVersion.mode = 'reject'
    mockPool.data = undefined // pool errored/absent too

    harness()

    expect(await screen.findByText('Backend health unavailable')).toBeInTheDocument()
    expect(screen.getByText(/Could not load backend component health/)).toBeInTheDocument()
    // The table degrades to its empty state rather than a blank panel.
    expect(screen.getByText('No components found')).toBeInTheDocument()
    // Pool section is hidden when there is no pool data.
    expect(screen.queryByText('Database Connection Pool')).not.toBeInTheDocument()
  })

  it('is a keyboard-operable accordion that collapses and re-opens its content', async () => {
    mockExtHealth.value = makeExtHealth()
    mockExtHealth.mode = 'resolve'
    mockVersion.value = makeVersion()
    mockVersion.mode = 'resolve'
    mockPool.data = makePool()

    harness()

    expect(await screen.findByText('Component Health')).toBeInTheDocument()

    // Header exposes an accessible expanded toggle (defaultOpen).
    const header = screen.getByRole('button', { expanded: true })
    expect(header).toHaveAttribute('aria-expanded', 'true')

    // Click collapses the body.
    fireEvent.click(header)
    expect(screen.queryByText('Component Health')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { expanded: false })).toHaveAttribute('aria-expanded', 'false')

    // Enter re-opens it (keyboard operability).
    fireEvent.keyDown(screen.getByRole('button', { expanded: false }), { key: 'Enter' })
    expect(await screen.findByText('Component Health')).toBeInTheDocument()
  })
})
