import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TirePressure from './TirePressure'

vi.mock('../api', () => ({
  getVehicles: vi.fn().mockResolvedValue([
    { id: 1, vin: 'TEST123', display_name: 'My Tesla' },
  ]),
  getTirePressure: vi.fn().mockResolvedValue([
    {
      id: 1,
      vehicle_id: 1,
      front_left: 2.9,
      front_right: 2.8,
      rear_left: 2.9,
      rear_right: 3.0,
      created_at: '2024-01-10T12:00:00Z',
    },
  ]),
}))

vi.mock('../hooks/useSettings', () => ({
  useSettings: () => ({
    convertPressure: (bar: number) => bar * 14.5038,
    pressureUnit: 'PSI',
  }),
}))

// Mock Recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
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
        <TirePressure />
      </BrowserRouter>
    </QueryClientProvider>,
  )

describe('TirePressure', () => {
  it('renders tire pressure page header', () => {
    renderPage()
    expect(screen.getByText('Tire Pressure')).toBeInTheDocument()
    expect(screen.getByText(/Monitor tire pressure/)).toBeInTheDocument()
  })

  it('shows car visualization', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByRole('img', { name: /tire pressure vehicle visualization/i })).toBeInTheDocument()
    })
  })

  it('shows 4 tire pressure gauges', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Front Left')).toBeInTheDocument()
    })
    expect(screen.getByText('Front Right')).toBeInTheDocument()
    expect(screen.getByText('Rear Left')).toBeInTheDocument()
    expect(screen.getByText('Rear Right')).toBeInTheDocument()
  })

  it('shows pressure history section', async () => {
    renderPage()
    await waitFor(() => {
      expect(screen.getByText('Pressure History')).toBeInTheDocument()
    })
  })

  it('handles no data state', async () => {
    const { getTirePressure } = await import('../api')
    vi.mocked(getTirePressure).mockResolvedValueOnce([])

    render(
      <QueryClientProvider client={createQueryClient()}>
        <BrowserRouter>
          <TirePressure />
        </BrowserRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('No pressure history data available')).toBeInTheDocument()
    })
  })
})
