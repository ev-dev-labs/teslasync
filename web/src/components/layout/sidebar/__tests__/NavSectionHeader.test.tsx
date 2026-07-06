import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NavSectionHeader } from '../NavSectionHeader'

describe('NavSectionHeader', () => {
  it('renders label as a non-interactive caption with the Phase-45 typography token', () => {
    render(<NavSectionHeader label="Pinned" />)
    const label = screen.getByText('Pinned')
    expect(label.tagName).toBe('P')
    expect(label).toHaveClass('text-2xs')
    expect(label).toHaveClass('font-semibold')
    expect(label).toHaveClass('uppercase')
    expect(label).toHaveClass('tracking-[0.14em]')
    expect(label).toHaveClass('text-[var(--text-muted)]')
  })

  it('does not render any actions when no action prop is provided', () => {
    render(<NavSectionHeader label="Pinned" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders the action slot when provided', () => {
    render(
      <NavSectionHeader
        label="Sections"
        action={<button type="button">Expand</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument()
  })

  it('applies the supplied id to the label so callers can use aria-labelledby', () => {
    render(<NavSectionHeader label="Recently Used" id="nav-recent-label" />)
    const label = screen.getByText('Recently Used')
    expect(label).toHaveAttribute('id', 'nav-recent-label')
  })

  it('merges additional className without overriding container layout classes', () => {
    const { container } = render(
      <NavSectionHeader label="Pinned" className="custom-extra-class" />,
    )
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper).toHaveClass('flex')
    expect(wrapper).toHaveClass('items-center')
    expect(wrapper).toHaveClass('justify-between')
    expect(wrapper).toHaveClass('px-3')
    expect(wrapper).toHaveClass('py-1')
    expect(wrapper).toHaveClass('custom-extra-class')
  })
})
