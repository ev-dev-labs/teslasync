/**
 * Masonry behaviour tests.
 *
 * Masonry is a dependency-free presentational layout primitive: it packs cards
 * of varying heights into balanced CSS multi-column columns. It has no hooks,
 * network, router, or context, so a bare render() is sufficient — and, matching
 * the sibling layout tests (PrefetchLink.test.tsx, NotificationBellPopover.test
 * .tsx), pointer interactions are driven with `fireEvent` (`@testing-library/
 * user-event` is intentionally NOT a dependency of this repo).
 *
 * Coverage:
 *   - default element (<div>) + children render as DIRECT descendants (the
 *     multi-column packing relies on the cards being immediate children)
 *   - the baked-in packing contract is always applied (column gutter,
 *     per-child vertical rhythm, and break-inside-avoid keep-whole)
 *   - the polymorphic `as` prop renders the requested element (section / ul)
 *     and a labelled <section> stays query-able as an ARIA region
 *   - caller className is merged, and Tailwind conflicts resolve in the
 *     caller's favour (gap-6 / [&>*]:mb-8 win over the baked-in defaults)
 *   - arbitrary DOM props (id, title, data-*, aria-*) forward to the element
 *   - user pointer handlers (onClick) fire
 *   - empty children render an empty container without throwing, while still
 *     carrying the packing contract for async-populated lists
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { Masonry } from './Masonry'

describe('Masonry', () => {
  it('renders a <div> by default and packs its children as direct descendants', () => {
    render(
      <Masonry data-testid="masonry">
        <div>Alpha</div>
        <div>Beta</div>
      </Masonry>,
    )
    const root = screen.getByTestId('masonry')
    expect(root.tagName).toBe('DIV')
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    // Multi-column packing requires the cards to be IMMEDIATE children so
    // `break-inside-avoid` and the per-child margin apply to each card.
    expect(root.children).toHaveLength(2)
  })

  it('always applies the baked-in multi-column packing contract', () => {
    render(
      <Masonry data-testid="masonry">
        <div>card</div>
      </Masonry>,
    )
    const root = screen.getByTestId('masonry')
    // Column gutter (1rem).
    expect(root).toHaveClass('gap-4')
    // Per-child vertical rhythm between stacked cards + keep-whole. These are
    // arbitrary-variant utilities, so assert against the raw class string.
    expect(root.className).toContain('[&>*]:mb-4')
    expect(root.className).toContain('[&>*]:break-inside-avoid')
  })

  it('merges caller column utilities while retaining every base utility', () => {
    render(
      <Masonry data-testid="masonry" className="columns-1 2xl:columns-2">
        <div>card</div>
      </Masonry>,
    )
    const root = screen.getByTestId('masonry')
    expect(root).toHaveClass('columns-1', '2xl:columns-2', 'gap-4')
    expect(root.className).toContain('[&>*]:mb-4')
    expect(root.className).toContain('[&>*]:break-inside-avoid')
  })

  it('lets a caller override the default gutter (tailwind-merge conflict wins)', () => {
    render(
      <Masonry data-testid="masonry" className="gap-6">
        <div>card</div>
      </Masonry>,
    )
    const root = screen.getByTestId('masonry')
    expect(root).toHaveClass('gap-6')
    // The conflicting baked-in gap-4 is dropped by tailwind-merge.
    expect(root.classList.contains('gap-4')).toBe(false)
    // Non-conflicting base utilities survive.
    expect(root.className).toContain('[&>*]:break-inside-avoid')
  })

  it('lets a caller override the per-child vertical rhythm', () => {
    render(
      <Masonry data-testid="masonry" className="[&>*]:mb-8">
        <div>card</div>
      </Masonry>,
    )
    const root = screen.getByTestId('masonry')
    expect(root.className).toContain('[&>*]:mb-8')
    expect(root.className).not.toContain('[&>*]:mb-4')
  })

  it('renders a labelled <section> via `as` that is query-able as an ARIA region', () => {
    render(
      <Masonry as="section" aria-label="Preference sections">
        <div>card</div>
      </Masonry>,
    )
    // A <section> with an accessible name exposes the `region` landmark role —
    // this mirrors the real SettingsPage usage.
    const region = screen.getByRole('region', { name: 'Preference sections' })
    expect(region.tagName).toBe('SECTION')
    // The packing classes travel to whatever element `as` renders.
    expect(region).toHaveClass('gap-4')
  })

  it('renders a list container via `as="ul"`', () => {
    render(
      <Masonry as="ul" data-testid="masonry">
        <li>item</li>
      </Masonry>,
    )
    const root = screen.getByTestId('masonry')
    expect(root.tagName).toBe('UL')
    expect(screen.getByRole('listitem')).toHaveTextContent('item')
  })

  it('forwards arbitrary DOM props to the underlying element', () => {
    render(
      <Masonry id="grid" data-testid="masonry" title="Card grid">
        <div>card</div>
      </Masonry>,
    )
    const root = screen.getByTestId('masonry')
    expect(root).toHaveAttribute('id', 'grid')
    expect(root).toHaveAttribute('title', 'Card grid')
  })

  it('forwards user pointer handlers (onClick fires exactly once)', () => {
    const onClick = vi.fn()
    render(
      <Masonry data-testid="masonry" onClick={onClick}>
        <div>card</div>
      </Masonry>,
    )
    fireEvent.click(screen.getByTestId('masonry'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders an empty container without throwing when it has no children', () => {
    render(<Masonry data-testid="masonry" />)
    const root = screen.getByTestId('masonry')
    expect(root).toBeInTheDocument()
    expect(root.children).toHaveLength(0)
    // The packing contract is still present so a later async fill packs cleanly.
    expect(root).toHaveClass('gap-4')
  })
})
