import { createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NavSectionHeader } from '../NavSectionHeader'

describe('NavSectionHeader', () => {
  it('preserves supplied brand and acronym casing without visual transformations', () => {
    render(<NavSectionHeader label="Tesla API" />);
    const label = screen.getByText('Tesla API');
    expect(label).not.toHaveClass('uppercase', 'capitalize');
  });

  it('renders label as a non-interactive caption with the shared label typography role', () => {
    render(<NavSectionHeader label="Pinned" />)
    const label = screen.getByText('Pinned')
    expect(label.tagName).toBe('P')
    expect(label).toHaveClass('text-xs')
    expect(label).toHaveClass('font-medium')
    expect(label).not.toHaveClass('uppercase', 'capitalize')
    expect(label).not.toHaveClass('tracking-[0.14em]')
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
    render(<NavSectionHeader label="Recently used" id="nav-recent-label" />)
    const label = screen.getByText('Recently used')
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

  it('preserves group labeling and full long RTL labels without truncation', () => {
    const label = 'قسم Tesla API ' + 'المركبات'.repeat(40)
    render(
      <section dir="rtl" aria-labelledby="nav-long-label">
        <NavSectionHeader label={label} id="nav-long-label" />
      </section>,
    )
    const group = screen.getByRole('region', { name: label })
    const caption = screen.getByText(label)
    expect(group).toHaveAttribute('dir', 'rtl')
    expect(caption).toHaveTextContent(label)
    expect(caption).toHaveClass('min-w-0', 'break-words')
    expect(caption).not.toHaveClass('truncate', 'whitespace-nowrap', 'uppercase', 'capitalize')
    expect(caption).not.toHaveAttribute('tabindex')
  })

  it('preserves action ref, native attributes, disclosure state, focus and keyboard callbacks', () => {
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    const onKeyDown = vi.fn()
    const action = (
      <button
        ref={ref}
        type="button"
        aria-expanded="false"
        aria-controls="nav-items"
        data-action="disclosure"
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        Expand
      </button>
    )
    const { rerender } = render(<NavSectionHeader label="Sections" action={action} />)
    const button = screen.getByRole('button', { name: 'Expand' })
    expect(ref.current).toBe(button)
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-controls', 'nav-items')
    expect(button).toHaveAttribute('data-action', 'disclosure')
    button.focus()
    expect(button).toHaveFocus()
    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.keyDown(button, { key: ' ' })
    expect(onKeyDown).toHaveBeenCalledTimes(2)
    expect(onKeyDown.mock.calls[0][0].key).toBe('Enter')
    expect(onKeyDown.mock.calls[1][0].key).toBe(' ')
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(2)
    rerender(<NavSectionHeader label="Updated sections" action={action} />)
    expect(ref.current).toBe(button)
    expect(button).toHaveFocus()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(3)
  })
})
