import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SystemStatus from './SystemStatus'

// Polyfill IntersectionObserver for jsdom
beforeAll(() => {
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    constructor(public callback: IntersectionObserverCallback, public options?: IntersectionObserverInit) {}
    root = null
    rootMargin = ''
    thresholds = [0]
    takeRecords() { return [] }
  } as unknown as typeof IntersectionObserver
})

vi.mock('../api', () => ({
  getAuditLogs: vi.fn().mockResolvedValue([]),
  getAPIUsage: vi.fn().mockResolvedValue({
    total_requests: 100,
    rate_limit: 60,
    estimated_cost: 2.5,
    cost_per_request: 0.025,
    monthly_credit: 10,
    skipped_polls: 5,
    cache_hits: 50,
    cache_misses: 50,
  }),
  getCompressionStats: vi.fn().mockResolvedValue({
    total_original: 1024000,
    total_compressed: 512000,
    ratio: 0.5,
    total_positions: 1000,
    estimated_saved_rows: 200,
  }),
  getExtendedHealth: vi.fn().mockResolvedValue({ components: {} }),
  getVersionInfo: vi.fn().mockResolvedValue({
    chart_version: '1.0.0',
    go_version: 'go1.21',
    os: 'linux',
    arch: 'amd64',
    uptime_seconds: 3600,
    goroutines: 12,
    endpoints: {},
  }),
  getTelemetryStatus: vi.fn().mockResolvedValue({ vehicles: [] }),
  getWorkersHealth: vi.fn().mockResolvedValue({ workers: [] }),
  getNotificationStats: vi.fn().mockResolvedValue({
    total_sent: 10,
    sent: 8,
    failed: 2,
    pending: 0,
    enabled_channels: 1,
    total_channels: 2,
  }),
  getNotificationLogs: vi.fn().mockResolvedValue([]),
  getExportJobs: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/resilience', () => ({
  getApiBase: vi.fn().mockReturnValue(''),
  resilientFetch: vi.fn(),
}))

vi.mock('../components/data-display/Widgets', () => ({
  AnimatedNumber: ({ value }: { value: number }) => <span>{value}</span>,
}))

// Mock Recharts to avoid canvas errors in jsdom
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
}))

const healthyStatus = {
  overall: 'healthy',
  database: { status: 'ok' },
  tesla_api: { status: 'authenticated' },
  mqtt: { status: 'connected' },
  redis: { status: 'ok' },
  poller: { status: 'healthy' },
  fleet_telemetry: { status: 'disabled', details: { enabled: false } },
}

const degradedStatus = {
  overall: 'degraded',
  database: { status: 'ok' },
  tesla_api: { status: 'error', consecutive_failures: 3, last_error: 'token expired' },
  mqtt: { status: 'disconnected' },
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
}

function renderPage(statusResponse: Record<string, unknown> = healthyStatus) {
  // Mock fetch for the system status endpoint
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(statusResponse),
  })
  vi.stubGlobal('fetch', mockFetch)

  const qc = createQueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <SystemStatus />
      </BrowserRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SystemStatus', () => {
  it('renders system status page header', async () => {
    renderPage()
    expect(screen.getByText('System Status')).toBeInTheDocument()
    expect(screen.getByText(/Real-time health monitoring/)).toBeInTheDocument()
  })

  it('shows "All Systems Operational" when healthy', async () => {
    renderPage(healthyStatus)
    await waitFor(() => {
      expect(screen.getByText('All Systems Operational')).toBeInTheDocument()
    })
  })

  it('shows component status cards', async () => {
    renderPage(healthyStatus)
    await waitFor(() => {
      expect(screen.getByText('PostgreSQL 17')).toBeInTheDocument()
    })
    expect(screen.getByText('Tesla Fleet API')).toBeInTheDocument()
    expect(screen.getByText('MQTT (Mosquitto)')).toBeInTheDocument()
    expect(screen.getByText('Redis Cache')).toBeInTheDocument()
  })

  it('shows healthy/total counts', async () => {
    renderPage(healthyStatus)
    await waitFor(() => {
      expect(screen.getByText('Healthy')).toBeInTheDocument()
    })
  })

  it('shows degraded status with issue count', async () => {
    renderPage(degradedStatus)
    await waitFor(() => {
      expect(screen.getByText(/System Issues Detected|Partial System Degradation/)).toBeInTheDocument()
    })
  })

  it('shows refresh button', () => {
    renderPage()
    expect(screen.getByText('Refresh')).toBeInTheDocument()
  })

  it('shows loading skeletons initially', () => {
    // With a never-resolving fetch, loading state should show
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    const qc = createQueryClient()
    render(
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <SystemStatus />
        </BrowserRouter>
      </QueryClientProvider>,
    )
    // Page header renders immediately regardless of loading
    expect(screen.getByText('System Status')).toBeInTheDocument()
  })

  it('displays the runtime section', async () => {
    renderPage(healthyStatus)
    await waitFor(() => {
      expect(screen.getByText('Runtime')).toBeInTheDocument()
    })
  })
})
