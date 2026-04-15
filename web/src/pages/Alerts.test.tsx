import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Alerts from './Alerts'

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
  getAlerts: vi.fn().mockResolvedValue([
    {
      id: 1,
      type: 'battery_low',
      severity: 'warning',
      message: 'Battery below 20%',
      vehicle_id: 1,
      is_read: false,
      created_at: new Date().toISOString(),
    },
    {
      id: 2,
      type: 'charging_complete',
      severity: 'info',
      message: 'Charging complete',
      vehicle_id: 1,
      is_read: true,
      created_at: new Date().toISOString(),
    },
  ]),
  markAlertRead: vi.fn().mockResolvedValue({}),
  getAlertRules: vi.fn().mockResolvedValue([
    {
      id: 1,
      type: 'battery_low',
      threshold: 20,
      enabled: true,
      severity: 'warning',
      vehicle_id: null,
      channel_ids: [],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  ]),
  updateAlertRule: vi.fn().mockResolvedValue({}),
  createAlertRule: vi.fn().mockResolvedValue({}),
  deleteAlertRule: vi.fn().mockResolvedValue({}),
  getNotificationChannels: vi.fn().mockResolvedValue([]),
  getNotificationLogs: vi.fn().mockResolvedValue([]),
  getNotificationStats: vi.fn().mockResolvedValue({ total_sent: 0 }),
  getVehicles: vi.fn().mockResolvedValue([
    { id: 1, vin: 'TEST123', display_name: 'My Tesla' },
  ]),
}))

vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({
    convertDistance: (v: number) => v,
    convertSpeed: (v: number) => v,
    convertTemp: (v: number) => v,
    convertEfficiency: (v: number) => v,
    convertPressure: (v: number) => v * 14.5038,
    distanceUnit: 'km',
    speedUnit: 'km/h',
    tempUnit: '°C',
    efficiencyUnit: 'Wh/km',
    pressureUnit: 'PSI',
  }),
}))

vi.mock('../components/feedback/Toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

vi.mock('../components/data-display/Widgets', () => ({
  RadialGauge: ({ label }: { label: string }) => <div data-testid={`gauge-${label}`}>{label}</div>,
  AnimatedNumber: ({ value }: { value: number }) => <span>{value}</span>,
}))

// Mock Recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
}))

// Mock Charts component used by Alerts
vi.mock('../components/charts/Charts', () => ({
  ChartTooltip: () => null,
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
}

const renderPage = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <BrowserRouter>
        <Alerts />
      </BrowserRouter>
    </QueryClientProvider>,
  )

describe('Alerts', () => {
  it('renders alerts page header', () => {
    renderPage()
    expect(screen.getByText('Alerts & Notifications')).toBeInTheDocument()
    expect(screen.getByText(/Monitor events, configure alert rules/)).toBeInTheDocument()
  })

  it('shows alert list', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Battery below 20%')).toBeInTheDocument()
    })
    expect(screen.getByText('Charging complete')).toBeInTheDocument()
  })

  it('shows alert stats row', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('This Week')).toBeInTheDocument()
    })
    expect(screen.getAllByText('Unread').length).toBeGreaterThanOrEqual(1)
  })

  it('shows alert preferences tab', () => {
    renderPage()
    expect(screen.getByText('Preferences')).toBeInTheDocument()
  })

  it('handles empty alerts', async () => {
    const { getAlerts } = await import('../api')
    vi.mocked(getAlerts).mockResolvedValueOnce([])

    render(
      <QueryClientProvider client={createQueryClient()}>
        <BrowserRouter>
          <Alerts />
        </BrowserRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('No alerts')).toBeInTheDocument()
    })
    expect(screen.getByText(/Your fleet is running smoothly/)).toBeInTheDocument()
  })
})
