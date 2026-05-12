import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { TeslaApiUsageCard } from '../TeslaApiUsageCard'
import type { APIUsage } from '@/api/types'
import type { APICallLogStats } from '@/types/admin'

const mockLogStats: { data: APICallLogStats | undefined } = { data: undefined }

vi.mock('@/api/hooks/useAdmin', () => ({
  useApiLogStats: () => ({ data: mockLogStats.data }),
}))

const NOW = Date.parse('2025-01-15T12:00:00Z')

function withRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

function makeUsage(overrides: Partial<APIUsage> = {}): APIUsage {
  return {
    total_requests: 39436,
    skipped_polls: 0,
    estimated_cost: 87.55,
    monthly_credit: 10,
    cost_per_request: 0.00222,
    estimated_remaining: 0,
    ...overrides,
  }
}

function makeLogStats(overrides: Partial<APICallLogStats> = {}): APICallLogStats {
  return {
    totalCalls: 39436,
    errorRate: 1.2, // backend returns this as a percentage already
    avgDurationMs: 184,
    last24h: 2800,
    errorCount: 470,
    by_method: { GET: 30000, POST: 9436 },
    by_service: {
      // camelCaseKeys may also add aliases like teslaFleet — dedup test below covers it
      tesla_fleet: 28000,
      tesla_streaming: 11000,
    },
    ...overrides,
  }
}

describe('TeslaApiUsageCard', () => {
  beforeEach(() => {
    mockLogStats.data = undefined
  })

  it('shows a no-data placeholder when apiUsage is undefined', () => {
    withRouter(<TeslaApiUsageCard apiUsage={undefined} now={NOW} />)
    expect(screen.getByText(/Tesla API usage data is not available/)).toBeInTheDocument()
  })

  it('renders the budget progress bar with the correct percentage', () => {
    mockLogStats.data = makeLogStats()
    withRouter(<TeslaApiUsageCard apiUsage={makeUsage()} now={NOW} />)
    const bar = screen.getByRole('progressbar', { name: /budget used/i })
    // 87.55 / 10 = 875.5%, but JS float math yields ~875.4999… → rounds to 875
    expect(bar).toHaveAttribute('aria-valuenow', '875')
    expect(screen.getByText(/875% of monthly credit/)).toBeInTheDocument()
  })

  it('displays the over-budget call-out and computes the overage', () => {
    mockLogStats.data = makeLogStats()
    withRouter(<TeslaApiUsageCard apiUsage={makeUsage()} now={NOW} />)
    expect(screen.getByText(/Over monthly credit/)).toBeInTheDocument()
    expect(screen.getByText(/exceeded the \$10\.00 monthly credit by \$77\.55/)).toBeInTheDocument()
  })

  it('renders the days-elapsed / reset countdown', () => {
    mockLogStats.data = makeLogStats()
    withRouter(<TeslaApiUsageCard apiUsage={makeUsage()} now={NOW} />)
    // Jan 15 → day 15 of 31, resets in 16 days
    expect(screen.getByText(/Day 15 of 31/)).toBeInTheDocument()
    expect(screen.getByText(/resets in 16 days/)).toBeInTheDocument()
  })

  it('lists top services and method splits when log stats are available', () => {
    mockLogStats.data = makeLogStats()
    withRouter(<TeslaApiUsageCard apiUsage={makeUsage()} now={NOW} />)
    expect(screen.getByText('tesla_fleet')).toBeInTheDocument()
    expect(screen.getByText('tesla_streaming')).toBeInTheDocument()
    expect(screen.getByText('GET')).toBeInTheDocument()
    expect(screen.getByText('POST')).toBeInTheDocument()
  })

  it('formats latency, error rate, and 24h volume', () => {
    mockLogStats.data = makeLogStats({ avgDurationMs: 184.7, errorRate: 7.0, errorCount: 200, last24h: 2800 })
    withRouter(<TeslaApiUsageCard apiUsage={makeUsage()} now={NOW} />)
    expect(screen.getByText('185 ms')).toBeInTheDocument()
    // 7.0% triggers red severity
    expect(screen.getByText(/7\.0%/)).toBeInTheDocument()
    expect(screen.getByText('2,800')).toBeInTheDocument()
  })

  it('dedupes camelCase aliases that camelCaseKeys() injects into nested maps', () => {
    mockLogStats.data = makeLogStats({
      by_service: {
        tesla_fleet: 28000,
        teslaFleet: 28000, // alias injected by camelCaseKeys
        tesla_streaming: 11000,
        teslaStreaming: 11000, // alias
      },
    })
    withRouter(<TeslaApiUsageCard apiUsage={makeUsage()} now={NOW} />)
    // Each service should appear exactly once
    expect(screen.getAllByText('tesla_fleet')).toHaveLength(1)
    expect(screen.getAllByText('tesla_streaming')).toHaveLength(1)
    expect(screen.queryByText('teslaFleet')).not.toBeInTheDocument()
    expect(screen.queryByText('teslaStreaming')).not.toBeInTheDocument()
  })

  it('renders both footer links', () => {
    mockLogStats.data = makeLogStats()
    withRouter(<TeslaApiUsageCard apiUsage={makeUsage()} now={NOW} />)
    expect(screen.getByRole('link', { name: /Open API Logs/ })).toHaveAttribute('href', '/api-logs')
    expect(screen.getByRole('link', { name: /Tesla account/ })).toHaveAttribute('href', '/tesla-account')
  })

  it('renders without log stats — falls back to em-dashes for missing fields', () => {
    mockLogStats.data = undefined
    withRouter(<TeslaApiUsageCard apiUsage={makeUsage({ estimated_cost: 5, total_requests: 1000 })} now={NOW} />)
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })
})
