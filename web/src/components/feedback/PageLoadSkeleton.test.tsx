import { render, screen } from '@testing-library/react'
import { PageLoadSkeleton } from './PageLoadSkeleton'

describe('PageLoadSkeleton', () => {
  it('renders an accessible busy region', () => {
    render(<PageLoadSkeleton />)
    const skeleton = screen.getByTestId('page-load-skeleton')
    expect(skeleton).toBeInTheDocument()
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(skeleton).toHaveAttribute('role', 'status')
    expect(skeleton).toHaveAccessibleName('Loading…')
  })

  it('renders the requested number of panels', () => {
    const { container } = render(<PageLoadSkeleton panels={5} />)
    // Select on GlassPanel's stable `data-print-card` contract marker rather
    // than a styling class: the panel surface is token-driven, so its utility
    // classes are an implementation detail that changes with the theme layer.
    const panels = container.querySelectorAll('[data-print-card]')
    expect(panels.length).toBe(5)
  })

  it('defaults to 3 panels when no count is provided', () => {
    const { container } = render(<PageLoadSkeleton />)
    const panels = container.querySelectorAll('[data-print-card]')
    expect(panels.length).toBe(3)
  })

  it('keeps the visible loading label and panel outlines when the real page header is already present', () => {
    render(<PageLoadSkeleton panels={1} showHeader={false} />)

    const status = screen.getByRole('status', { name: 'Loading…' })
    expect(screen.getByText('Loading…')).toBeVisible()
    expect(status.querySelector(':scope > div > [aria-hidden="true"]')).toBeNull()
    const panel = status.querySelector('[data-print-card]')
    expect(panel).toHaveAttribute('aria-hidden', 'true')
    const metrics = panel?.querySelector('[data-app-part="metric-grid"]')
    expect(metrics?.querySelectorAll('[data-app-skeleton="fact"]')).toHaveLength(3)
    expect(metrics?.nextElementSibling).toHaveAttribute('data-app-part', 'skeleton')
  })
})
