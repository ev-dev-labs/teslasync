import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { StatusHero } from '../StatusHero'

describe('StatusHero', () => {
  it.each([
    ['healthy', 'circle-check'],
    ['degraded', 'triangle-alert'],
    ['unhealthy', 'circle-x'],
    ['unknown', 'circle-help'],
    ['maintenance', 'wrench'],
  ] as const)('uses the shared panel shadow without decorative glow for populated %s status', (status, icon) => {
    const onClick = vi.fn()
    const { container } = render(
      <StatusHero
        status={status}
        id="system-health"
        className="mt-4"
        headline="Instance status"
        subline="Last checked 12s ago"
        live
        cta={{ label: 'Run check', onClick }}
      />,
    )
    const panel = container.querySelector('#system-health')
    expect(panel).toHaveClass('shadow-panel', 'mt-4')
    expect(panel).not.toHaveAttribute('style')
    expect(panel?.querySelector(`svg.lucide-${icon}`)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('heading', { name: 'Instance status' })).toBeInTheDocument()
    expect(screen.getByText(/Last checked 12s ago/)).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Run check' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['healthy',     'All systems operational'],
    ['degraded',    'Degraded performance'],
    ['unhealthy',   'Service outage'],
    ['unknown',     'Status unknown'],
    ['maintenance', 'Scheduled maintenance'],
  ] as const)('renders the default headline for %s', (status, expectedHeadline) => {
    render(<StatusHero status={status} />)
    expect(screen.getByText(expectedHeadline)).toBeInTheDocument()
  })

  it('overrides the default headline when one is supplied', () => {
    render(<StatusHero status="healthy" headline="Custom headline" />)
    expect(screen.getByText('Custom headline')).toBeInTheDocument()
    expect(screen.queryByText('All systems operational')).not.toBeInTheDocument()
  })

  it('renders the subline when provided', () => {
    render(<StatusHero status="healthy" subline="Last checked 12s ago" />)
    expect(screen.getByText(/Last checked 12s ago/)).toBeInTheDocument()
  })

  it('fires the CTA handler when clicked', () => {
    const onClick = vi.fn()
    render(<StatusHero status="healthy" cta={{ label: 'Run check', onClick }} />)
    fireEvent.click(screen.getByRole('button', { name: /Run check/i }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('exposes the status region with aria-live for screen readers', () => {
    render(<StatusHero status="degraded" />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-live', 'polite')
  })
})
