import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { deriveDataState, type DataState } from '@/api/dataState'
import { ResourcesPanel, type ResourceRow, type ResourcesPanelProps } from '../ResourcesPanel'

function row(overrides: Partial<Extract<ResourceRow, { metricKind?: 'utilization' }>> = {}): ResourceRow {
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

  function workers(
    healthyCount: number | null,
    totalCount: number | null,
    overrides: Partial<Extract<ResourceRow, { metricKind: 'healthy-workers' }>> = {},
  ): ResourceRow {
    return {
      metricKind: 'healthy-workers',
      label: 'Workers',
      valueText: 'Worker reading',
      healthyCount,
      totalCount,
      ...overrides,
    }
  }

  describe('ResourcesPanel semantic API', () => {
    it.each([
      [95, 100, 'Degraded', 'warning'],
      [100, 100, 'Healthy', 'success'],
      [0, 8, 'Critical', 'danger'],
    ])('classifies %s/%s worker health from raw counts', (healthy, total, status, color) => {
      render(<ResourcesPanel rows={[workers(healthy, total)]} />)
      const bar = screen.getByRole('progressbar', { name: 'Workers health' })
      expect(bar).toHaveAttribute('aria-valuenow', String(Math.round(healthy / total * 100)))
      expect(bar.firstElementChild).toHaveStyle({ width: `${healthy / total * 100}%` })
      expect(bar.firstElementChild).toHaveClass(`bg-[var(--semantic-${color})]`)
      expect(screen.getByText('Worker reading')).toHaveClass(`text-[var(--semantic-${color})]`)
      expect(screen.getByText(status)).toBeInTheDocument()
    })

    it.each([
      [null, 100], [1, null], [0, 0], [1, 0], [-1, 10], [1, -10],
      [11, 10], [0.5, 10], [1, 10.5], [NaN, 10], [1, NaN],
      [Infinity, 10], [1, Infinity], [-Infinity, 10], [1, -Infinity],
      [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1],
      [1, Number.MAX_SAFE_INTEGER + 1],
    ])('keeps invalid or unconfigured workers %s/%s unknown without a bar', (healthy, total) => {
      render(<ResourcesPanel rows={[workers(healthy, total)]} />)
      expect(screen.queryByRole('progressbar')).toBeNull()
      expect(screen.getByText('Unknown')).toBeInTheDocument()
      expect(screen.getByText('Worker reading')).toBeInTheDocument()
      expect(screen.getByText('Worker reading')).not.toHaveClass('text-[var(--semantic-danger)]')
    })

    it('does not coerce missing raw counts into an outage', () => {
      const missing = workers(0, 8)
      Reflect.deleteProperty(missing, 'healthyCount')
      render(<ResourcesPanel rows={[missing]} />)
      expect(screen.queryByRole('progressbar')).toBeNull()
      expect(screen.getByText('Unknown')).toBeInTheDocument()
    })

    it.each([
      [69, 'normal', 'bg-[var(--text-secondary)]'],
      [70, 'warning', 'bg-[var(--semantic-warning)]'],
      [90, 'critical', 'bg-[var(--semantic-danger)]'],
    ])('keeps explicit utilization %s at the original %s boundary', (percent, _status, color) => {
      render(<ResourcesPanel rows={[row({ metricKind: 'utilization', percent })]} />)
      expect(screen.getByRole('progressbar', { name: 'Memory usage' }).firstElementChild).toHaveClass(color)
    })

    it('uses caller-localized presentation without parsing the label or value', () => {
      render(<ResourcesPanel rows={[workers(95, 100, {
        label: 'Kapazität',
        valueText: '100%',
        barAriaLabel: 'Gesundheit der Dienste',
        statusText: 'Teilweise verfügbar',
      })]} />)
      expect(screen.getByRole('progressbar', { name: 'Gesundheit der Dienste' })).toHaveAttribute('aria-valuenow', '95')
      expect(screen.getByText('Teilweise verfügbar')).toBeInTheDocument()
      expect(screen.getByText('100%')).toHaveClass('text-[var(--semantic-warning)]')
    })

    it('preserves maximum safe integer counts without inventing capacity', () => {
      render(<ResourcesPanel rows={[workers(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)]} />)
      expect(screen.getByText('Healthy')).toBeInTheDocument()
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    })

    it('keeps plain readings unclassified and without a measured bar', () => {
      render(<ResourcesPanel rows={[row()]} />)
      expect(screen.getByText('1.8 GB')).toBeInTheDocument()
      expect(screen.queryByText('Unknown')).toBeNull()
      expect(screen.queryByRole('progressbar')).toBeNull()
    })

    it('does not fabricate initial zero/outage and leaves measured neighbors intact', () => {
      render(<ResourcesPanel rows={[
        workers(0, 8, { sourceState: deriveDataState({ isPending: true }) }),
        row({ percent: 42 }),
      ]} />)
      expect(screen.getByText('Workers')).toBeInTheDocument()
      expect(screen.getByText('Loading')).toBeInTheDocument()
      expect(screen.queryByText('Worker reading')).toBeNull()
      expect(screen.queryByText('Critical')).toBeNull()
      expect(screen.queryByRole('progressbar', { name: 'Workers health' })).toBeNull()
      expect(screen.getByRole('progressbar', { name: 'Memory usage' })).toHaveAttribute('aria-valuenow', '42')
    })

    it('replaces only a fatal no-data source row and retries its own source', () => {
      const retry = vi.fn()
      const { rerender } = render(
        <MemoryRouter>
          <ResourcesPanel rows={[
            workers(null, null, { sourceState: deriveDataState({ error: new Error('Request failed'), refetch: retry }) }),
            row({ percent: 42 }),
          ]} />
        </MemoryRouter>,
      )
      expect(screen.getByText('Workers')).toBeInTheDocument()
      expect(screen.queryByText('Worker reading')).toBeNull()
      expect(screen.getByRole('progressbar', { name: 'Memory usage' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
      expect(retry).toHaveBeenCalledTimes(1)
      rerender(<MemoryRouter><ResourcesPanel rows={[
        workers(8, 8, { sourceState: deriveDataState({ data: { healthy: 8 } }) }),
        row({ percent: 42 }),
      ]} /></MemoryRouter>)
      expect(screen.getByRole('progressbar', { name: 'Workers health' })).toHaveAttribute('aria-valuenow', '100')
      expect(screen.getByRole('progressbar', { name: 'Memory usage' })).toBeInTheDocument()
    })

    it('retains healthy values with an independent refresh-failure trust warning and retry', () => {
      const retry = vi.fn()
      const state = deriveDataState({
        data: { healthy: 100 }, error: new Error('Refresh failed'),
        dataUpdatedAt: 1234, refetch: retry,
      }, { provenance: 'live' })
      render(<ResourcesPanel rows={[
        workers(100, 100, { sourceState: state }),
        row({ percent: 70 }),
      ]} />)
      expect(screen.getByText('Healthy')).toBeInTheDocument()
      expect(screen.getByRole('progressbar', { name: 'Workers health' }).firstElementChild).toHaveClass('bg-[var(--semantic-success)]')
      expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('role', 'status')
      expect(screen.getByText('Workers may be out of date')).toBeInTheDocument()
      expect(screen.getByText('Worker reading')).toBeInTheDocument()
      expect(screen.getByRole('progressbar', { name: 'Memory usage' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      expect(retry).toHaveBeenCalledTimes(1)
      expect(state.updatedAt).toBe(1234)
      expect(state.provenance).toBe('cached')
    })

    it.each(['stale', 'paused', 'offline'] as const)('retains an outage reading independently of %s trust', (kind) => {
      const state: DataState<unknown> = deriveDataState({
        data: { healthy: 0 },
        fetchStatus: kind === 'stale' ? 'idle' : 'paused',
        dataUpdatedAt: 1000,
      }, { maxAgeMs: 100, now: () => 2000 })
      render(<ResourcesPanel rows={[workers(0, 8, { sourceState: state })]} />)
      const bar = screen.getByRole('progressbar', { name: 'Workers health' })
      expect(bar).toHaveAttribute('aria-valuenow', '0')
      expect(bar.firstElementChild).toHaveStyle({ width: '0%' })
      expect(bar.firstElementChild).toHaveClass('bg-[var(--semantic-danger)]')
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument()
      expect(screen.getByText('Worker reading')).toBeInTheDocument()
    })
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

  it('flags critical usage (>= 90%) with semantic danger bar + value colours', () => {
    render(<ResourcesPanel rows={[row({ label: 'Disk', valueText: '95%', percent: 95 })]} />)
    const bar = screen.getByRole('progressbar', { name: 'Disk usage' })
    expect(bar).toHaveAttribute('aria-valuenow', '95')
    expect(bar.firstElementChild as HTMLElement).toHaveClass('bg-[var(--semantic-danger)]')
    expect(screen.getByText('95%')).toHaveClass('text-[var(--semantic-danger)]')
  })

  it('flags warning usage (>= 70%) with amber bar + value colours', () => {
    render(<ResourcesPanel rows={[row({ label: 'Pool', valueText: '75%', percent: 75 })]} />)
    const bar = screen.getByRole('progressbar', { name: 'Pool usage' })
    expect(bar.firstElementChild as HTMLElement).toHaveClass('bg-[var(--semantic-warning)]')
    expect(screen.getByText('75%')).toHaveClass('text-[var(--semantic-warning)]')
  })

  it('shows normal usage (< 70%) neutrally without implying confirmed success', () => {
    render(<ResourcesPanel rows={[row({ label: 'Pool', valueText: '40%', percent: 40 })]} />)
    const value = screen.getByText('40%')
    expect(screen.getByRole('progressbar').firstElementChild as HTMLElement).toHaveClass('bg-[var(--text-secondary)]')
    expect(value).not.toHaveClass('text-[var(--semantic-danger)]')
    expect(value).not.toHaveClass('text-[var(--semantic-warning)]')
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
    expect(over.firstElementChild as HTMLElement).toHaveClass('bg-[var(--semantic-danger)]')

    const under = screen.getByRole('progressbar', { name: 'Under usage' })
    expect(under).toHaveAttribute('aria-valuenow', '0')
    expect(under.firstElementChild as HTMLElement).toHaveStyle({ width: '0%' })
    expect(under.firstElementChild as HTMLElement).toHaveClass('bg-[var(--text-secondary)]')
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
    const props: ResourcesPanelProps = { rows: [] }
    Reflect.set(props, 'rows', undefined)
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

  it.each([0, 70, 90, 100])('preserves measured %s usage including threshold boundaries', (percent) => {
    render(<ResourcesPanel rows={[row({ percent })]} />)
    const bar = screen.getByRole('progressbar', { name: 'Memory usage' })
    expect(bar).toHaveAttribute('aria-valuenow', String(percent))
    expect(bar.firstElementChild).toHaveStyle({ width: `${percent}%` })
    expect(bar.firstElementChild).toHaveClass('motion-reduce:transition-none')
  })

  it.each([Infinity, -Infinity])('keeps non-finite %s usage unknown', (percent) => {
    render(<ResourcesPanel rows={[row({ percent, valueText: 'Unknown' })]} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('keeps long labels, values, metadata and native footnote links reachable in RTL', () => {
    const label = 'Long resource label '.repeat(12)
    const valueText = '1234567890'.repeat(12)
    const metaText = 'Long supporting metadata '.repeat(12)
    render(
      <div dir="rtl">
        <ResourcesPanel
          rows={[row({ label, valueText, metaText })]}
          footnote={<a href="/system/resources" target="_blank" rel="noreferrer">Resource details</a>}
        />
      </div>,
    )
    expect(screen.getByText(label.trim())).toHaveClass('break-words')
    expect(screen.getByText(label.trim())).not.toHaveClass('truncate')
    expect(screen.getByText(valueText)).toHaveClass('max-w-full', 'break-words')
    expect(screen.getByText(metaText.trim())).toHaveClass('ms-1')
    const link = screen.getByRole('link', { name: 'Resource details' })
    expect(link).toHaveAttribute('href', '/system/resources')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    link.focus()
    expect(link).toHaveFocus()
  })
})
