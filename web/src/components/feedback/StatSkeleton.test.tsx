import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * StatSkeleton contract.
 *
 * The skeleton stands in for a row of stat cards while data loads. The tests
 * pin three things that matter in production:
 *
 *  - a11y: it is a labelled, busy `status` region so assistive tech announces
 *    the loading state (the original had no role/aria at all);
 *  - responsive columns: the `sm:grid-cols-N` utility is emitted as a *static*
 *    class string. Tailwind's JIT never generates an interpolated
 *    `sm:grid-cols-${count}`, so the old code produced a class the stylesheet
 *    never contained — and degenerate counts (0 / negative / NaN / fractional)
 *    produced invalid utilities like `sm:grid-cols-0` / `sm:grid-cols--3`;
 *  - null-safety: every degenerate `count` still renders a valid container with
 *    a stable card count and a clamped, valid column class.
 *
 * react-i18next is mocked to echo the English fallback so the accessible name
 * is deterministic without pulling the i18n runtime into the spec (mirrors the
 * convention used by MaintenanceBanner.test / TotpKpiBand.test).
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

import { StatSkeleton } from './StatSkeleton'

/** The status container the component renders as its root. */
function getRegion() {
  return screen.getByRole('status')
}

/** GlassPanel always stamps `data-print-card`; one per rendered stat card. */
function cardCount(container: HTMLElement) {
  return container.querySelectorAll('[data-print-card]').length
}

describe('StatSkeleton', () => {
  it('renders a labelled, busy status region so assistive tech announces loading', () => {
    render(<StatSkeleton />)
    const region = screen.getByRole('status', { name: /loading statistics/i })
    expect(region).toBeInTheDocument()
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(region).toHaveAttribute('aria-label', 'Loading statistics')
    expect(region).toHaveAttribute('data-testid', 'stat-skeleton')
  })

  it('defaults to a 4-card, 4-column grid when no count is provided', () => {
    const { container } = render(<StatSkeleton />)
    const region = getRegion()
    expect(cardCount(container)).toBe(4)
    // The region maps its cards as direct children, so both counts agree.
    expect(region.children).toHaveLength(4)
    expect(region).toHaveClass('grid', 'grid-cols-2', 'gap-3', 'sm:grid-cols-4')
  })

  it('each card renders a label + value skeleton pair (8 pulses for 4 cards)', () => {
    const { container } = render(<StatSkeleton count={4} />)
    // Skeleton renders one animate-pulse element; two per GlassPanel card.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(8)
  })

  it('renders the requested number of cards with a matching static column class', () => {
    const { container } = render(<StatSkeleton count={6} />)
    const region = getRegion()
    expect(cardCount(container)).toBe(6)
    expect(region).toHaveClass('sm:grid-cols-6')
  })

  it('emits a complete literal sm:grid-cols class (never an interpolated ${count})', () => {
    // Guards against the original Tailwind-JIT bug: the applied token must be a
    // real utility from the safelist, not a runtime-built string.
    const { unmount } = render(<StatSkeleton count={3} />)
    expect(getRegion()).toHaveClass('sm:grid-cols-3')
    unmount()
    render(<StatSkeleton count={2} />)
    expect(getRegion()).toHaveClass('sm:grid-cols-2')
  })

  it('truncates a fractional count toward zero (3.7 → 3 cards, sm:grid-cols-3)', () => {
    const { container } = render(<StatSkeleton count={3.7} />)
    expect(cardCount(container)).toBe(3)
    expect(getRegion()).toHaveClass('sm:grid-cols-3')
  })

  it('handles count=0: renders the region with no cards and a valid clamped column class', () => {
    const { container } = render(<StatSkeleton count={0} />)
    const region = getRegion()
    // Still a real, announced container — not a blank/absent panel.
    expect(region).toBeInTheDocument()
    expect(cardCount(container)).toBe(0)
    // Clamped to a shipped utility; never the invalid `sm:grid-cols-0`.
    expect(region).toHaveClass('sm:grid-cols-1')
    expect(region).not.toHaveClass('sm:grid-cols-0')
  })

  it('clamps a negative count to zero cards and a valid column class (no sm:grid-cols--3)', () => {
    const { container } = render(<StatSkeleton count={-3} />)
    const region = getRegion()
    expect(cardCount(container)).toBe(0)
    expect(region).toHaveClass('sm:grid-cols-1')
    expect(region.className).not.toContain('grid-cols--3')
  })

  it('falls back to 4 cards when count is NaN', () => {
    const { container } = render(<StatSkeleton count={Number.NaN} />)
    expect(cardCount(container)).toBe(4)
    expect(getRegion()).toHaveClass('sm:grid-cols-4')
    expect(getRegion().className).not.toContain('grid-cols-NaN')
  })

  it('renders all cards for a large count while clamping the column class to 12', () => {
    const { container } = render(<StatSkeleton count={20} />)
    const region = getRegion()
    // Card count stays faithful to the request…
    expect(cardCount(container)).toBe(20)
    // …but the responsive column class clamps to a utility Tailwind ships.
    expect(region).toHaveClass('sm:grid-cols-12')
    expect(region.className).not.toContain('grid-cols-20')
  })

  it('merges a caller-supplied className onto the grid container', () => {
    render(<StatSkeleton className="mt-8 custom-marker" />)
    const region = getRegion()
    expect(region).toHaveClass('mt-8', 'custom-marker')
    // Base layout classes are preserved alongside the extras.
    expect(region).toHaveClass('grid', 'grid-cols-2')
  })
})
