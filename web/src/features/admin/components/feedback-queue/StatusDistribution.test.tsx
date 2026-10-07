/**
 * StatusDistribution — proportional new/triaged/closed bar + a labelled legend.
 *
 * The contract pinned here:
 *   • always renders exactly three legend rows in new → triaged → closed
 *     order, even when a facet count is missing (null-safety) or the whole
 *     total is 0 (no divide-by-zero, never a blank panel);
 *   • each legend sublabel is `${fmtInt(count)} · ${fmtPercent(pct, 0)}` with
 *     percentages taken against the caller-supplied `total`, integer counts
 *     locale-formatted with thousands separators;
 *   • the coloured bar is the single role="img"; its aria-label interpolates
 *     the live counts, it draws one segment per status wider than 0.3% (sub-
 *     pixel slivers are dropped from the bar but KEPT in the legend), and each
 *     segment width is clamped to ≤100% so a degenerate `total` (smaller than
 *     a facet count) can never overflow the track or print ">100%".
 *
 * react-i18next is mocked to echo the English fallback AND interpolate
 * `{{token}}` placeholders from the options bag, so the aria-label is a
 * deterministic, human-readable string. framer-motion is mocked to a
 * passthrough because the `@/components/ui` barrel this file pulls in ships
 * motion-driven components; the mock keeps module load hermetic and avoids
 * act() churn even though StatusDistribution renders no motion itself.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const Component = (props.as as string) ?? 'div'
        const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>
        return <Component {...(rest as Record<string, unknown>)}>{children as ReactNode}</Component>
      },
    },
  ),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _key
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v))
        }
      }
      return out
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

import { StatusDistribution } from './StatusDistribution'

/** The proportional bar is the sole role="img"; its direct children are the
 *  rendered (>0.3%) segments. */
function getBar(): HTMLElement {
  return screen.getByRole('img')
}
function getSegments(): HTMLElement[] {
  return Array.from(getBar().children) as HTMLElement[]
}

describe('StatusDistribution', () => {
  it('renders exactly three legend rows ordered new → triaged → closed', () => {
    render(<StatusDistribution counts={{ new: 5, triaged: 3, closed: 2 }} total={10} />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)

    const labels = items.map((li) => within(li).getByText(/^(New|Triaged|Closed)$/).textContent)
    expect(labels).toEqual(['New', 'Triaged', 'Closed'])
  })

  it('renders each count and its share of the caller-supplied total', () => {
    render(<StatusDistribution counts={{ new: 5, triaged: 3, closed: 2 }} total={10} />)
    // total = 10 → 50% / 30% / 20%
    expect(screen.getByText('5 · 50%')).toBeInTheDocument()
    expect(screen.getByText('3 · 30%')).toBeInTheDocument()
    expect(screen.getByText('2 · 20%')).toBeInTheDocument()
  })

  it('exposes the bar to assistive tech with an aria-label that reflects the live counts', () => {
    render(<StatusDistribution counts={{ new: 5, triaged: 3, closed: 2 }} total={10} />)
    expect(getBar()).toHaveAttribute(
      'aria-label',
      'Status distribution: 5 new, 3 triaged, 2 closed',
    )
  })

  it('draws one coloured segment per status with proportional width and a descriptive title', () => {
    render(<StatusDistribution counts={{ new: 5, triaged: 3, closed: 2 }} total={10} />)
    const segs = getSegments()
    expect(segs).toHaveLength(3)
    expect(segs[0].style.width).toBe('50%')
    expect(segs[0]).toHaveStyle({ backgroundColor: '#f59e0b' })
    expect(segs[0].getAttribute('title')).toBe('New: 5 (50%)')
    expect(segs[2].getAttribute('title')).toBe('Closed: 2 (20%)')
  })

  it('treats a missing facet count as 0 without crashing (null-safety)', () => {
    render(<StatusDistribution counts={{ new: 4 }} total={4} />)
    expect(screen.getByText('4 · 100%')).toBeInTheDocument()
    expect(screen.getAllByText('0 · 0%')).toHaveLength(2)
    expect(getBar()).toHaveAttribute(
      'aria-label',
      'Status distribution: 4 new, 0 triaged, 0 closed',
    )
  })

  it('renders three 0% legend rows and no bar segments when the total is 0 (no divide-by-zero, no blank panel)', () => {
    render(<StatusDistribution counts={{}} total={0} />)
    expect(screen.getAllByText('0 · 0%')).toHaveLength(3)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    // Bar still present (named), but carries no proportional segments.
    expect(getSegments()).toHaveLength(0)
  })

  it('drops sub-0.3% slivers from the bar while keeping every status in the legend', () => {
    render(<StatusDistribution counts={{ new: 1, triaged: 0, closed: 999 }} total={1000} />)
    // new = 0.1% (hidden), triaged = 0% (hidden), closed = 99.9% (shown).
    const segs = getSegments()
    expect(segs).toHaveLength(1)
    expect(segs[0].getAttribute('title')).toBe('Closed: 999 (100%)')
    // Legend keeps all three, including the hidden sliver rounded to 0%.
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('1 · 0%')).toBeInTheDocument()
  })

  it('clamps a degenerate total so a facet count above it never overflows or prints >100%', () => {
    render(<StatusDistribution counts={{ new: 10, triaged: 0, closed: 0 }} total={5} />)
    // raw new share = 200% → clamped to 100%.
    const segs = getSegments()
    expect(segs[0].style.width).toBe('100%')
    expect(screen.getByText('10 · 100%')).toBeInTheDocument()
    expect(screen.queryByText(/200%/)).toBeNull()
  })

  it('locale-formats large integer counts with thousands separators', () => {
    render(<StatusDistribution counts={{ new: 1234, triaged: 0, closed: 0 }} total={1234} />)
    expect(screen.getByText('1,234 · 100%')).toBeInTheDocument()
  })
})
