import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { StatusHero } from '../StatusHero'

describe('StatusHero', () => {
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
