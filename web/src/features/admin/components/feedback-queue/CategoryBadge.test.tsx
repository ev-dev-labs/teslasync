/**
 * CategoryBadge contract.
 *
 * Maps a feedback category ('bug' | 'feature' | 'other') onto a coloured
 * <Badge> chip whose variant encodes intent (danger / info / neutral) and whose
 * text is the translated, human-readable category label. The category is always
 * conveyed by text — never colour alone — so the chip stays accessible.
 *
 * Coverage:
 *   1. Each known category → correct label text + Badge variant colour class.
 *   2. Distinct variant colours across the three known categories.
 *   3. The visible label is driven by i18n (t(key, fallback)), not the raw enum.
 *   4. An unknown category (a newer server enum leaking past the TS union) fails
 *      closed to the neutral "Other / question" chip rather than an empty,
 *      colourless badge — and never throws.
 *   5. Renders as a single inline-flex rounded-full span (Badge shell intact).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Deterministic i18n: t(key, fallback) returns the English fallback so the label
// assertions don't depend on translation-file contents. Mirrors the pattern used
// by the sibling ApiKeyPermissionBadge / QueueStatusPanel tests in admin/.
vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

import { CategoryBadge } from './CategoryBadge'
import type { FeedbackCategory } from '@/api/types'
import { BADGE_VARIANTS } from '@/components/ui';

function renderBadge(category: FeedbackCategory) {
  const { container } = render(<CategoryBadge category={category} />)
  const chip = container.querySelector('span')
  return { container, chip }
}

describe('CategoryBadge', () => {
  it('renders a bug report as a red danger chip', () => {
    const { chip } = renderBadge('bug')
    expect(chip).not.toBeNull()
    expect(chip?.textContent?.trim()).toBe('Bug report')
    expect(chip?.className).toContain('bg-red-100')
    expect(chip?.className).toContain('text-red-800')
  })

  it('renders a feature request as a blue info chip', () => {
    const { chip } = renderBadge('feature')
    expect(chip?.textContent?.trim()).toBe('Feature request')
    expect(chip?.className).toContain('bg-blue-100')
    expect(chip?.className).not.toContain('bg-red-100')
  })

  it('renders other/question as a neutral grey chip', () => {
    const { chip } = renderBadge('other')
    expect(chip?.textContent?.trim()).toBe('Other / question')
    expect(chip?.className).toContain(BADGE_VARIANTS.neutral)
  })

  it('assigns a distinct variant colour per known category', () => {
    const bg = (category: FeedbackCategory) =>
      render(<CategoryBadge category={category} />).container.querySelector('span')
        ?.className ?? ''
    const bug = bg('bug')
    const feature = bg('feature')
    const other = bg('other')
    expect(bug).toContain('bg-red-100')
    expect(feature).toContain('bg-blue-100')
    expect(other).toContain(BADGE_VARIANTS.neutral)
    expect(bug).not.toEqual(feature)
    expect(feature).not.toEqual(other)
  })

  it('drives the visible label from i18n fallbacks, not the raw enum key', () => {
    renderBadge('bug')
    // The translated fallback is shown; neither the enum value nor the i18n key
    // ever leaks to the UI.
    expect(screen.getByText('Bug report')).toBeInTheDocument()
    expect(screen.queryByText('bug')).toBeNull()
    expect(screen.queryByText('feedback.category.bug')).toBeNull()
  })

  it('fails closed to the neutral "Other / question" chip for an unknown category', () => {
    // Simulate a newer server enum leaking past the compile-time union.
    const unknownCategory = 'escalation' as unknown as FeedbackCategory
    const { chip } = renderBadge(unknownCategory)
    expect(chip?.textContent?.trim()).toBe('Other / question')
    expect(chip?.className).toContain(BADGE_VARIANTS.neutral)
    expect(chip?.className).not.toContain('bg-red-100')
    expect(chip?.className).not.toContain('bg-blue-100')
  })

  it('never throws or renders an empty badge for an empty category string', () => {
    const emptyCategory = '' as unknown as FeedbackCategory
    expect(() => render(<CategoryBadge category={emptyCategory} />)).not.toThrow()
    // Always the fail-closed label — never a blank, colourless chip.
    expect(screen.getByText('Other / question')).toBeInTheDocument()
  })

  it('renders as a single inline-flex rounded-full Badge span', () => {
    const { container, chip } = renderBadge('bug')
    const spans = container.querySelectorAll('span')
    expect(spans).toHaveLength(1)
    expect(chip?.className).toContain('inline-flex')
    expect(chip?.className).toContain('rounded-full')
    expect(chip?.className).toContain('font-medium')
  })
})
