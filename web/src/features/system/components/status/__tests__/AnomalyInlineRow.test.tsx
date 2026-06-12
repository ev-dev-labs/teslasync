import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { AnomalyInlineRow } from '../AnomalyInlineRow'

const mockVehiclesData: { data: Array<{ id: number }> | undefined } = { data: undefined }
const mockAnomaliesData: { data: unknown } = { data: undefined }

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => mockVehiclesData,
}))

vi.mock('@/api/client', () => ({
  request: vi.fn(() => Promise.resolve(mockAnomaliesData.data)),
}))

function renderWithProviders(ui: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AnomalyInlineRow', () => {
  beforeEach(() => {
    mockVehiclesData.data = undefined
    mockAnomaliesData.data = undefined
  })

  it('renders nothing when there are no vehicles configured', () => {
    mockVehiclesData.data = []
    const { container } = renderWithProviders(<AnomalyInlineRow />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when anomalies_last_24h is 0', async () => {
    mockVehiclesData.data = [{ id: 1 }]
    mockAnomaliesData.data = {
      anomalies: [],
      anomalies_last_24h: 0,
      anomalies_last_7d: 0,
      health_summary: 'healthy',
      signals_monitored: 5,
    }
    const { container } = renderWithProviders(<AnomalyInlineRow />)
    await new Promise((r) => setTimeout(r, 30))
    expect(container.firstChild).toBeNull()
  })

  it('renders a HealthRow when there is at least one anomaly in the last 24h', async () => {
    mockVehiclesData.data = [{ id: 7 }]
    mockAnomaliesData.data = {
      anomalies: [
        {
          signal: 'battery_voltage',
          type: 'spike',
          severity: 'warning',
          value: 14.2,
          baseline: 12.5,
          z_score: 4.3,
          detected_at: new Date(Date.now() - 12 * 60_000).toISOString(),
          message: 'unusual reading',
        },
      ],
      anomalies_last_24h: 1,
      anomalies_last_7d: 1,
      health_summary: 'warning',
      signals_monitored: 5,
    }
    renderWithProviders(<AnomalyInlineRow />)
    expect(await screen.findByText('Anomalies')).toBeInTheDocument()
    expect(screen.getByText(/1 in 24h/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Anomalies/ })
    expect(link).toHaveAttribute('href', '/anomaly-detection')
  })
})
