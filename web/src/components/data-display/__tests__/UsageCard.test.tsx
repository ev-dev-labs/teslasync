import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs'
import {
  UsageCard,
  type UsageCardBand,
  type UsageCardDetail,
  type UsageCardTopList,
} from '../UsageCard'

let previousPreferences: ReturnType<typeof getFormatterPreferences>

beforeEach(() => {
  previousPreferences = getFormatterPreferences()
  setGlobalPrecision(2)
  setGlobalLocale('en-US')
})

afterEach(() => {
  cleanup()
  setGlobalPrecision(previousPreferences.precision)
  setGlobalLocale(previousPreferences.locale)
})

function wrap(ui: ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('UsageCard', () => {
  it('updates accessible budget percentages while preserving raw overflow and caller strings', () => {
    setGlobalPrecision(2)
    wrap(<UsageCard budget={{ headline: '$12.345 raw caller text', pct: 123.456, ariaLabel: 'Budget' }} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuetext', '123.46%')
    act(() => setGlobalPrecision(3))
    expect(bar).toHaveAttribute('aria-valuetext', '123.456%')
    expect(bar).toHaveAttribute('aria-valuenow', '123')
    expect(screen.getByText('$12.345 raw caller text')).toBeInTheDocument()
  })
  it('preserves supplied band and top-list label casing', () => {
    wrap(
      <UsageCard
        bands={[{ label: 'Tesla API', value: '12' }]}
        topLists={[{ key: 'units', title: 'Energy (kWh)', items: [{ key: 'home', label: 'Home', value: '5' }] }]}
      />,
    )
    expect(screen.getByText('Tesla API')).not.toHaveClass('uppercase', 'capitalize')
    expect(screen.getByText('Energy (kWh)')).not.toHaveClass('uppercase', 'capitalize')
  })

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
    const group = screen.getByText('By feature').closest('[data-app-part~="card"]')
    expect(group).toHaveAttribute('data-surface-variant', 'standalone')
    expect(group?.querySelector('[data-app-part~="list-heading"]')).toHaveTextContent('By feature')
    const list = within(group as HTMLElement).getByRole('list')
    expect(list).toHaveAttribute('data-app-list', 'ranked')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
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
    expect(internal).toHaveAttribute('data-app-part', 'button')
    expect(internal).toHaveAttribute('data-app-variant', 'ghost')

    const external = screen.getByRole('link', { name: /docs/i })
    expect(external).toHaveAttribute('href', 'https://example.com/docs')
    expect(external).toHaveAttribute('target', '_blank')
    expect(external).toHaveAttribute('rel', 'noopener noreferrer')
    expect(external).toHaveAttribute('data-app-variant', 'primary')
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

  it.each([0, -12, 72.5, 250])('retains source percentage %s with only visual clamping', (pct) => {
    wrap(<UsageCard budget={{ headline: 'Source budget', pct, ariaLabel: 'Budget' }} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', String(Math.max(0, Math.round(pct))))
    expect(bar.firstElementChild).toHaveStyle({ width: `${Math.max(0, Math.min(100, pct))}%` })
  })

  it.each([NaN, Infinity, -Infinity])('does not invent a measured percentage for %s', (pct) => {
    wrap(<UsageCard budget={{ headline: 'Unknown source budget', pct, ariaLabel: 'Budget' }} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(bar).toHaveAttribute('aria-valuetext', '—')
    expect(bar).toBeEmptyDOMElement()
    expect(screen.getByText('Unknown source budget')).toBeInTheDocument()
  })

  it('retains zero, unknown, rich captions and long source labels without truncation', () => {
    const label = 'https://example.com/' + 'long-source-limitation/'.repeat(12)
    wrap(
      <UsageCard
        className="owned-card"
        budget={{ headline: 'Known zero', rightLabel: 0, caption: <strong>Source scope</strong>, pct: 0, ariaLabel: 'Budget' }}
        bands={[{ label: 'Calls', value: 0, sub: 0 }]}
        details={[{ label: 'Unobserved', value: '—' }]}
        topLists={[{ key: 'prior', title: 'Prior history', items: [{ key: 'source', label, value: 0 }] }]}
      />,
    )
    expect(screen.getAllByText('0')).toHaveLength(4)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('Source scope').tagName).toBe('STRONG')
    expect(screen.getByText('Prior history')).toBeInTheDocument()
    expect(screen.getByText(label)).not.toHaveClass('truncate')
    expect(screen.getByText(label)).toHaveClass('break-all')
    expect(screen.getByText('Known zero').closest('.owned-card')).toBeInTheDocument()
  })

  it('keeps native footer links reachable with shared focus and wrapping roles', () => {
    wrap(<UsageCard footer={[{ key: 'route', to: '/prior', label: 'Prior history' }]} />)
    const link = screen.getByRole('link', { name: 'Prior history' })
    expect(link).toHaveAttribute('href', '/prior')
    expect(link).toHaveClass('min-h-11', 'min-w-11', 'max-w-full', 'focus-visible:outline-2')
    link.focus()
    expect(link).toHaveFocus()
    // Row-17 text rule: wrap at word boundaries (break-words), never per character.
    expect(screen.getByText('Prior history')).toHaveClass('break-words', 'text-start')
  })

  it('binds actual history/disclaimer surfaces and footer links to all pack consumers without owning the default tree (source-only)', () => {
    const { container } = wrap(<UsageCard
      topLists={[
        { key: 'history', title: 'Prior 30-day cycles', items: [{ key: 'prior', label: '0 events', value: '$0.00' }] },
        { key: 'source', title: 'Source and limitations', items: [{ key: 'estimate', label: 'Locally observed traffic, not an invoice', value: 'Estimated' }] },
      ]}
      footer={[
        { key: 'logs', to: '/api-logs', label: 'Open API logs' },
        { key: 'docs', to: 'https://example.com/reference', label: 'Pricing reference', primary: true, external: true },
      ]}
    />)
    container.setAttribute('data-app-design-preview', '')
    const surfaces = Array.from(container.querySelectorAll('[data-app-part~="card"]'))
    const links = screen.getAllByRole('link')
    const packs = Object.keys(APPLICATION_DESIGNS) as Array<Parameters<typeof getAppDesignAttributes>[0]>
    for (const pack of packs) {
      const rules: postcss.Rule[] = []
      postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'packs', `${pack}.css`), 'utf8'))
        .walkRules(rule => { rules.push(rule) })
      const surfaceRules = rules.filter(rule => rule.selector.includes('[data-app-part~="card"]')
        && rule.nodes.some(node => node.type === 'decl' && /^(border|background|box-shadow)/.test(node.prop)))
      const buttonRules = rules.filter(rule => rule.selector.includes('[data-app-part~="button"]')
        && rule.nodes.some(node => node.type === 'decl' && /^(border|background|box-shadow)/.test(node.prop)))
      expect(surfaces.some(surface => surfaceRules.some(rule => surface.matches(rule.selector)))).toBe(false)
      for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) container.setAttribute(name, value)
      const release = observeAppDesignScopes(container)
      try {
        for (const surface of surfaces) expect(surfaceRules.some(rule => surface.matches(rule.selector)), pack).toBe(true)
        for (const link of links) expect(buttonRules.some(rule => link.matches(rule.selector)), pack).toBe(true)
        expect(surfaces[0]).toHaveTextContent('0 events$0.00')
        expect(surfaces[1]).toHaveTextContent('Locally observed traffic, not an invoiceEstimated')
        expect(container.querySelector('[role="progressbar"]')).toBeNull()
      } finally { release() }
    }
  })
})
