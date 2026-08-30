/**
 * CategoryMix — proportion bars for the feedback queue's bug/feature/other mix.
 *
 * The whole contract is pinned here:
 *   • always renders exactly three bars in bug → feature → other order, even
 *     when a facet count is missing/undefined (null-safety) or the entire mix
 *     is zero (no divide-by-zero, never a blank panel);
 *   • each sublabel is `${fmtInt(count)} · ${fmtPercent(pct, 0)}` and the
 *     percentage is computed against the CATEGORY total ONLY — unrelated status
 *     counts riding in the same `FeedbackCounts` bag must not dilute it;
 *   • integer counts are locale-formatted with thousands separators;
 *   • the group is exposed to assistive tech as a named list of three items.
 *
 * framer-motion is mocked to a passthrough because MetricBar animates its fill
 * via `motion.div` and also reads `useReducedMotion()` (via the shared
 * `useMotionPreference` hook) to decide whether that fill tween runs; the
 * mock stubs both so assertions stay on the synchronous DOM and avoid
 * act() churn. react-i18next is mocked to echo the English fallback so labels
 * and the aria group name are deterministic.
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
  useReducedMotion: () => false,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

import { CategoryMix } from './CategoryMix'
import type { FeedbackCounts } from './constants'

describe('CategoryMix', () => {
  it('renders exactly three labelled bars, ordered bug → feature → other', () => {
    render(<CategoryMix counts={{ bug: 6, feature: 3, other: 1 }} />)

    const list = screen.getByRole('list', { name: 'Feedback category mix' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)

    expect(screen.getByText('Bug report')).toBeInTheDocument()
    expect(screen.getByText('Feature request')).toBeInTheDocument()
    expect(screen.getByText('Other / question')).toBeInTheDocument()

    const labels = items.map((li) => within(li).getByText(/report|request|question/).textContent)
    expect(labels).toEqual(['Bug report', 'Feature request', 'Other / question'])
  })

  it('renders each count and its share of the category total', () => {
    render(<CategoryMix counts={{ bug: 6, feature: 3, other: 1 }} />)
    // total = 10 → 60% / 30% / 10%
    expect(screen.getByText('6 · 60%')).toBeInTheDocument()
    expect(screen.getByText('3 · 30%')).toBeInTheDocument()
    expect(screen.getByText('1 · 10%')).toBeInTheDocument()
  })

  it('treats a missing category count as 0 without crashing (null-safety)', () => {
    // Only `bug` supplied → feature/other fall back to 0.
    render(<CategoryMix counts={{ bug: 4 }} />)
    expect(screen.getByText('4 · 100%')).toBeInTheDocument()
    expect(screen.getAllByText('0 · 0%')).toHaveLength(2)
  })

  it('renders 0% for every bar when the mix is empty (no divide-by-zero, no blank panel)', () => {
    render(<CategoryMix counts={{}} />)
    expect(screen.getAllByText('0 · 0%')).toHaveLength(3)
    // Still three named bars rather than a hidden/empty section.
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('excludes unrelated status counts from the category percentage math', () => {
    // new/triaged/closed live in the same FeedbackCounts bag but must NOT be
    // summed into the category total: total is 1 (bug) + 1 (feature) = 2.
    const counts: FeedbackCounts = { new: 100, triaged: 50, closed: 25, bug: 1, feature: 1 }
    render(<CategoryMix counts={counts} />)

    expect(screen.getAllByText('1 · 50%')).toHaveLength(2) // bug + feature
    expect(screen.getByText('0 · 0%')).toBeInTheDocument() // other
    // Had the 175 status counts leaked in, bug would read 1/177 ≈ 1%, not 50%.
    expect(screen.queryByText('1 · 1%')).toBeNull()
  })

  it('locale-formats large integer counts with thousands separators', () => {
    render(<CategoryMix counts={{ bug: 1234, feature: 0, other: 0 }} />)
    expect(screen.getByText('1,234 · 100%')).toBeInTheDocument()
  })
})
