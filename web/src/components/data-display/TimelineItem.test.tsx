import { type ReactNode } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { TimelineItem } from './TimelineItem'

const renderRouted = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('TimelineItem — content', () => {
  it('renders the title and time labels', () => {
    render(<TimelineItem title="Charge started" time="2m ago" color="#22c55e" />)
    expect(screen.getByText('Charge started')).toBeInTheDocument()
    expect(screen.getByText('2m ago')).toBeInTheDocument()
  })

  it('renders the subtitle when provided and omits it otherwise', () => {
    const { rerender } = render(
      <TimelineItem title="Drive ended" subtitle="42 mi · 58 min" time="1h ago" color="#00f0ff" />,
    )
    expect(screen.getByText('42 mi · 58 min')).toBeInTheDocument()

    rerender(<TimelineItem title="Drive ended" time="1h ago" color="#00f0ff" />)
    expect(screen.queryByText('42 mi · 58 min')).not.toBeInTheDocument()
  })

  it('renders the provided icon inside a decorative (aria-hidden) swatch', () => {
    render(
      <TimelineItem
        title="Alert"
        time="now"
        color="#ef4444"
        icon={<span data-testid="tl-icon">!</span>}
      />,
    )
    const icon = screen.getByTestId('tl-icon')
    expect(icon).toBeInTheDocument()
    // the swatch wrapper hides decorative art from assistive tech
    expect(icon.parentElement).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders badges below the subtitle when provided and omits the row otherwise', () => {
    const { rerender } = render(
      <TimelineItem
        title="Alert"
        time="now"
        color="#ef4444"
        badges={<span data-testid="tl-badge">critical</span>}
      />,
    )
    expect(screen.getByTestId('tl-badge')).toBeInTheDocument()

    rerender(<TimelineItem title="Alert" time="now" color="#ef4444" />)
    expect(screen.queryByTestId('tl-badge')).not.toBeInTheDocument()
  })
})

describe('TimelineItem — colour swatch null-safety', () => {
  it('applies the accent colour inline when a hex colour is provided', () => {
    render(
      <TimelineItem
        title="Charge complete"
        time="now"
        color="#00f0ff"
        icon={<span data-testid="tl-icon" />}
      />,
    )
    const swatch = screen.getByTestId('tl-icon').parentElement as HTMLElement
    // cssstyle normalises the hex to rgb() for the `color` longhand
    expect(swatch.style.color).toBe('rgb(0, 240, 255)')
    // an inline style is present, so it must NOT use the neutral fallback class
    expect(swatch.getAttribute('style')).toContain('color')
    expect(swatch.className).not.toContain('bg-[var(--surface-2)]')
  })

  it('falls back to a neutral surface (never an invalid "undefined15" colour) when colour is missing', () => {
    const { container } = render(
      <TimelineItem title="System event" time="now" icon={<span data-testid="tl-icon" />} />,
    )
    const swatch = screen.getByTestId('tl-icon').parentElement as HTMLElement
    expect(swatch.className).toContain('bg-[var(--surface-2)]')
    expect(swatch.getAttribute('style')).toBeNull()
    // regression guard: the pre-hardening code produced `background-color:#undefined15`
    expect(container.innerHTML).not.toContain('undefined')
  })

  it('treats a blank colour string the same as a missing colour', () => {
    render(<TimelineItem title="x" time="now" color="   " icon={<span data-testid="tl-icon" />} />)
    const swatch = screen.getByTestId('tl-icon').parentElement as HTMLElement
    expect(swatch.className).toContain('text-[var(--text-muted)]')
    expect(swatch.getAttribute('style')).toBeNull()
  })
})

describe('TimelineItem — empty-value placeholders', () => {
  it('renders an em-dash instead of a blank line for an empty title', () => {
    render(<TimelineItem title="" time="just now" color="#22c55e" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders an em-dash for an empty time', () => {
    const { container } = render(<TimelineItem title="Woke up" time="" color="#22c55e" />)
    expect(container.textContent).toContain('—')
  })
})

describe('TimelineItem — connector line', () => {
  it('shows the connector line by default (non-terminal row)', () => {
    const { container } = render(<TimelineItem title="a" time="now" color="#22c55e" />)
    expect(container.querySelector('.w-px')).not.toBeNull()
  })

  it('hides the connector line for the last row', () => {
    const { container } = render(<TimelineItem title="a" time="now" color="#22c55e" isLast />)
    expect(container.querySelector('.w-px')).toBeNull()
  })
})

describe('TimelineItem — navigation (href)', () => {
  it('renders a plain, non-interactive row when no href is given', () => {
    const { container } = render(<TimelineItem title="a" time="now" color="#22c55e" />)
    expect(container.querySelector('a')).toBeNull()
    expect((container.firstChild as HTMLElement).className).toContain('flex gap-3')
  })

  it('wraps the row in a focusable Link with the correct href when href is set', () => {
    renderRouted(<TimelineItem title="Alert fired" time="now" color="#ef4444" href="/alerts/7" />)
    const link = screen.getByRole('link', { name: /alert fired/i })
    expect(link).toHaveAttribute('href', '/alerts/7')
    // keyboard / visible-focus affordance for drill-through
    expect(link.className).toContain('focus-visible:outline')
  })

  it('navigates to the href when the row is clicked', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <TimelineItem title="Charge started" time="2m ago" color="#22c55e" href="/alerts/7" />
            }
          />
          <Route path="/alerts/7" element={<div>Alert Detail Page</div>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.queryByText('Alert Detail Page')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: /charge started/i }))
    expect(screen.getByText('Alert Detail Page')).toBeInTheDocument()
  })
})
