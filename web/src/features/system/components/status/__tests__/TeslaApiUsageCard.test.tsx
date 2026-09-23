import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { TeslaApiUsageCard } from '../TeslaApiUsageCard'
import type { APIUsage } from '@/api/types'

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: (value: number) => `$${value.toFixed(2)}` }),
}))

const usage: APIUsage = {
  current: {
    start: '2026-09-01T00:00:00Z', end: '2026-10-01T00:00:00Z',
    signals: 150000, commands: 1000, data_requests: 500, wakes: 50,
    estimated_usd: 4,
  },
  history: [{
    start: '2026-08-02T00:00:00Z', end: '2026-09-01T00:00:00Z',
    signals: 0, commands: 0, data_requests: 0, wakes: 0, estimated_usd: 0,
  }],
  rate_source: 'https://developer.tesla.com/docs/fleet-api#pricing',
  disclaimer: 'Not an invoice.',
}
const renderCard = (value?: APIUsage, props: { loading?: boolean; error?: Error } = {}) =>
  render(<MemoryRouter><TeslaApiUsageCard apiUsage={value} now={Date.now()} {...props} /></MemoryRouter>)

describe('Tesla Fleet usage estimate', () => {
  it('handles loading, error and missing evidence separately', () => {
    const { rerender } = renderCard(undefined, { loading: true })
    expect(screen.getByText(/Loading Tesla usage/)).toBeInTheDocument()
    rerender(<MemoryRouter><TeslaApiUsageCard apiUsage={undefined} now={0} error={new Error('down')} /></MemoryRouter>)
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument()
    rerender(<MemoryRouter><TeslaApiUsageCard apiUsage={undefined} now={0} /></MemoryRouter>)
    expect(screen.getByText(/not available yet/)).toBeInTheDocument()
  })
  it('shows four billable categories and retained zero-cost history without claiming a bill', () => {
    renderCard(usage)
    expect(screen.getByText('$4.00')).toBeInTheDocument()
    expect(screen.getByText('Streaming signals')).toBeInTheDocument()
    expect(screen.getByText('Commands · 1,000 / $1')).toBeInTheDocument()
    expect(screen.getByText('Data requests · 500 / $1')).toBeInTheDocument()
    expect(screen.getByText('Wakes · 50 / $1')).toBeInTheDocument()
    expect(screen.getByText('$0.00')).toBeInTheDocument()
    expect(screen.getByText(/not a Tesla invoice/)).toBeInTheDocument()
    expect(screen.queryByText(/monthly credit/)).not.toBeInTheDocument()
  })
  it('keeps status concise and links to the dedicated page, including when usage is unavailable', () => {
    const { rerender } = render(<MemoryRouter><TeslaApiUsageCard apiUsage={usage} now={0} compact /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Explore Tesla API usage' })).toHaveAttribute('href', '/tesla-api-usage')
    expect(screen.queryByText('Prior 30-day cycles')).not.toBeInTheDocument()
    expect(screen.getByText(/not a Tesla invoice/)).toBeInTheDocument()
    rerender(<MemoryRouter><TeslaApiUsageCard apiUsage={undefined} now={0} compact error={new Error('offline')} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Explore Tesla API usage' })).toHaveAttribute('href', '/tesla-api-usage')
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument()
  })
})
