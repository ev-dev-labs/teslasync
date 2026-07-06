import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ResourcesPanel, type ResourceRow, type ResourcesPanelProps } from '../ResourcesPanel'

function row(overrides: Partial<ResourceRow> = {}): ResourceRow {
  return { label: 'Memory', valueText: '1.8 GB', ...overrides }
}

describe('ResourcesPanel', () => {
  it('renders the default "Resources" heading and every row label + value', () => {
    render(
      <ResourcesPanel
        rows={[
          row({ label: 'Memory', valueText: '1.8 GB' }),
          row({ label: 'DB connections', valueText: '5' }),
        ]}
      />,
    )
    expect(screen.getByRole('heading', { level: 3, name: 'Resources' })).toBeInTheDocument()
    expect(screen.getByText('Memory')).toBeInTheDocument()
    expect(screen.getByText('1.8 GB')).toBeInTheDocument()
    expect(screen.getByText('DB connections')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('overrides the heading text via the `title` prop', () => {
    render(<ResourcesPanel rows={[row()]} title="Server load" />)
    expect(screen.getByText('Server load')).toBeInTheDocument()
    expect(screen.queryByText('Resources')).not.toBeInTheDocument()
  })

  it('renders the optional metaText beside the value', () => {
    render(<ResourcesPanel rows={[row({ valueText: '1.8 GB', metaText: 'of 8 GB' })]} />)
    expect(screen.getByText('1.8 GB')).toBeInTheDocument()
    expect(screen.getByText('of 8 GB')).toBeInTheDocument()
  })

  it('renders an accessible progress bar with min/max/now ARIA values', () => {
    render(<ResourcesPanel rows={[row({ label: 'CPU', valueText: '42%', percent: 42 })]} />)
    const bar = screen.getByRole('progressbar', { name: 'CPU usage' })
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar.firstElementChild as HTMLElement).toHaveStyle({ width: '42%' })
  })

  it('omits the progress bar when percent is not supplied', () => {
    render(<ResourcesPanel rows={[row({ label: 'Threads', valueText: '318' })]} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    // The row itself still renders — only the bar is skipped.
    expect(screen.getByText('Threads')).toBeInTheDocument()
    expect(screen.getByText('318')).toBeInTheDocument()
  })

  it('flags critical usage (>= 90%) with red bar + value colours', () => {
    render(<ResourcesPanel rows={[row({ label: 'Disk', valueText: '95%', percent: 95 })]} />)
    const bar = screen.getByRole('progressbar', { name: 'Disk usage' })
    expect(bar).toHaveAttribute('aria-valuenow', '95')
    expect(bar.firstElementChild as HTMLElement).toHaveClass('bg-red-400')
    expect(screen.getByText('95%')).toHaveClass('text-red-400')
  })

  it('flags warning usage (>= 70%) with amber bar + value colours', () => {
    render(<ResourcesPanel rows={[row({ label: 'Pool', valueText: '75%', percent: 75 })]} />)
    const bar = screen.getByRole('progressbar', { name: 'Pool usage' })
    expect(bar.firstElementChild as HTMLElement).toHaveClass('bg-amber-400')
    expect(screen.getByText('75%')).toHaveClass('text-amber-400')
  })

  it('shows normal usage (< 70%) in green without alert colours', () => {
    render(<ResourcesPanel rows={[row({ label: 'Pool', valueText: '40%', percent: 40 })]} />)
    const value = screen.getByText('40%')
    expect(screen.getByRole('progressbar').firstElementChild as HTMLElement).toHaveClass('bg-green-400')
    expect(value).not.toHaveClass('text-red-400')
    expect(value).not.toHaveClass('text-amber-400')
  })

  it('clamps out-of-range percentages into [0, 100] for both width and ARIA', () => {
    render(
      <ResourcesPanel
        rows={[
          row({ label: 'Over', valueText: 'over', percent: 150 }),
          row({ label: 'Under', valueText: 'under', percent: -20 }),
        ]}
      />,
    )
    const over = screen.getByRole('progressbar', { name: 'Over usage' })
    expect(over).toHaveAttribute('aria-valuenow', '100')
    expect(over.firstElementChild as HTMLElement).toHaveStyle({ width: '100%' })
    expect(over.firstElementChild as HTMLElement).toHaveClass('bg-red-400')

    const under = screen.getByRole('progressbar', { name: 'Under usage' })
    expect(under).toHaveAttribute('aria-valuenow', '0')
    expect(under.firstElementChild as HTMLElement).toHaveStyle({ width: '0%' })
    expect(under.firstElementChild as HTMLElement).toHaveClass('bg-green-400')
  })

  it('skips the bar for non-finite percentages instead of rendering "NaN%"', () => {
    render(<ResourcesPanel rows={[row({ label: 'Broken', valueText: 'n/a', percent: Number.NaN })]} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText('Broken')).toBeInTheDocument()
    expect(screen.getByText('n/a')).toBeInTheDocument()
  })

  it('shows an empty state instead of a blank panel when there are no rows', () => {
    render(<ResourcesPanel rows={[]} />)
    expect(screen.getByText('No resource metrics available')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
    // The heading is always present so operators can tell "empty" from "broken".
    expect(screen.getByRole('heading', { level: 3, name: 'Resources' })).toBeInTheDocument()
  })

  it('honours a custom emptyText', () => {
    render(<ResourcesPanel rows={[]} emptyText="Nothing to report" />)
    expect(screen.getByText('Nothing to report')).toBeInTheDocument()
    expect(screen.queryByText('No resource metrics available')).toBeNull()
  })

  it('does not crash when rows is undefined (defensive null-safety)', () => {
    const props = { rows: undefined } as unknown as ResourcesPanelProps
    render(<ResourcesPanel {...props} />)
    expect(screen.getByText('No resource metrics available')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('renders the footnote alongside populated rows', () => {
    render(<ResourcesPanel rows={[row()]} footnote="CPU % pending" />)
    expect(screen.getByText('CPU % pending')).toBeInTheDocument()
  })

  it('renders the footnote even when the empty state is shown', () => {
    render(<ResourcesPanel rows={[]} footnote={<span>disk usage pending</span>} />)
    expect(screen.getByText('disk usage pending')).toBeInTheDocument()
    expect(screen.getByText('No resource metrics available')).toBeInTheDocument()
  })

  it('marks a supplied icon as decorative (aria-hidden)', () => {
    render(
      <ResourcesPanel
        rows={[row({ label: 'Memory', valueText: '1.8 GB', icon: <svg data-testid="mem-icon" /> })]}
      />,
    )
    const icon = screen.getByTestId('mem-icon')
    expect(icon).toBeInTheDocument()
    expect(icon.closest('span')).toHaveAttribute('aria-hidden', 'true')
  })

  it('forwards id and className to the underlying panel', () => {
    const { container } = render(
      <ResourcesPanel rows={[row()]} id="res-panel" className="custom-class" />,
    )
    const panel = container.querySelector('#res-panel')
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveClass('custom-class')
    expect(panel).toHaveClass('p-4')
  })
})
