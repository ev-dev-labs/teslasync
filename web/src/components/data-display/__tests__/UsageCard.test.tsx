import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  UsageCard,
  type UsageCardBand,
  type UsageCardDetail,
  type UsageCardTopList,
} from '../UsageCard'

function wrap(ui: ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('UsageCard', () => {
  it('renders the empty state when no sections are provided', () => {
    wrap(<UsageCard emptyMessage="Nothing here yet." />)
    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument()
  })

  it('renders the budget bar with clamped pct + aria attributes', () => {
    wrap(
      <UsageCard
        budget={{
          headline: '$0.42 of $5.00',
          rightLabel: '8% of monthly credit',
          caption: 'Day 5 of 30',
          pct: 250,
          ariaLabel: 'AI monthly spend',
          intent: 'warn',
        }}
      />,
    )
    expect(screen.getByText('$0.42 of $5.00')).toBeInTheDocument()
    expect(screen.getByText('8% of monthly credit')).toBeInTheDocument()
    expect(screen.getByText('Day 5 of 30')).toBeInTheDocument()

    const bar = screen.getByRole('progressbar', { name: /ai monthly spend/i })
    expect(bar).toHaveAttribute('aria-valuenow', '250')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
  })

  it('renders bands with values and intent tinting', () => {
    const bands: UsageCardBand[] = [
      { label: 'Calls', value: '12', sub: 'today' },
      { label: 'Tokens', value: '1,234', intent: 'warn' },
      { label: 'Cost', value: '$0.04' },
    ]
    wrap(<UsageCard bands={bands} />)
    expect(screen.getByText('Calls')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('today')).toBeInTheDocument()
    expect(screen.getByText('Tokens')).toBeInTheDocument()
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(screen.getByText('Cost')).toBeInTheDocument()
    expect(screen.getByText('$0.04')).toBeInTheDocument()
  })

  it('renders detail key/value cells', () => {
    const details: UsageCardDetail[] = [
      { label: 'Avg latency', value: '120ms' },
      { label: 'Errors', value: 3, intent: 'danger' },
    ]
    wrap(<UsageCard details={details} />)
    expect(screen.getByText('Avg latency')).toBeInTheDocument()
    expect(screen.getByText('120ms')).toBeInTheDocument()
    expect(screen.getByText('Errors')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders top-list blocks', () => {
    const topLists: UsageCardTopList[] = [
      {
        key: 'by-feature',
        title: 'By feature',
        items: [
          { key: 'chatbot', label: 'chatbot', value: 7 },
          { key: 'route_summary', label: 'route_summary', value: 3 },
        ],
      },
    ]
    wrap(<UsageCard topLists={topLists} />)
    expect(screen.getByText('By feature')).toBeInTheDocument()
    expect(screen.getByText('chatbot')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('route_summary')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('renders the alert banner when provided', () => {
    wrap(
      <UsageCard
        banner={{
          title: 'Over monthly credit',
          description: 'Consider upgrading or pausing for the month.',
          intent: 'danger',
        }}
      />,
    )
    expect(screen.getByText('Over monthly credit')).toBeInTheDocument()
    expect(
      screen.getByText('Consider upgrading or pausing for the month.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('renders footer links — internal Link and external anchor', () => {
    wrap(
      <UsageCard
        footer={[
          { key: 'logs', to: '/api-logs', label: 'View logs' },
          {
            key: 'docs',
            to: 'https://example.com/docs',
            label: 'Docs',
            external: true,
            primary: true,
          },
        ]}
      />,
    )
    const internal = screen.getByRole('link', { name: /view logs/i })
    expect(internal).toHaveAttribute('href', '/api-logs')

    const external = screen.getByRole('link', { name: /docs/i })
    expect(external).toHaveAttribute('href', 'https://example.com/docs')
    expect(external).toHaveAttribute('target', '_blank')
    expect(external).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders all sections together when fully populated', () => {
    wrap(
      <UsageCard
        budget={{
          headline: '$1 of $10',
          ariaLabel: 'monthly spend',
          pct: 10,
        }}
        bands={[{ label: 'Calls', value: 4 }]}
        details={[{ label: 'Latency', value: '50ms' }]}
        topLists={[
          {
            key: 'tl',
            title: 'Top features',
            items: [{ key: 'a', label: 'feature-a', value: 1 }],
          },
        ]}
        banner={{ title: 'Heads up', description: 'Watch usage', intent: 'warn' }}
        footer={[{ key: 'go', to: '/go', label: 'Go' }]}
      />,
    )
    expect(screen.getByText('$1 of $10')).toBeInTheDocument()
    expect(screen.getByText('Calls')).toBeInTheDocument()
    expect(screen.getByText('Latency')).toBeInTheDocument()
    expect(screen.getByText('Top features')).toBeInTheDocument()
    expect(screen.getByText('Heads up')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /go/i })).toBeInTheDocument()
  })
})
