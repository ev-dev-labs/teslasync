/**
 * StatusBadge contract.
 *
 * Maps a feedback lifecycle status ('new' | 'triaged' | 'closed') onto a
 * coloured <Badge> chip whose variant encodes intent (warning / success /
 * neutral) and whose text is the translated, human-readable status label. The
 * status is always conveyed by text — never colour alone — so the chip stays
 * accessible.
 *
 * Coverage:
 *   1. Each known status → correct label text + Badge variant colour class.
 *   2. Distinct variant colours across the three known statuses.
 *   3. The visible label is driven by i18n (t(key, fallback)), not the raw enum.
 *   4. An unknown status (a newer server enum leaking past the TS union) fails
 *      closed to a neutral "Unknown" chip rather than an empty, colourless
 *      badge — and never throws. Crucially it is NOT masked as "Closed", so an
 *      unrecognised (possibly still-active) status is never mistaken for a
 *      terminal one.
 *   5. Empty / nullish status is handled without throwing.
 *   6. Renders as a single inline-flex rounded-full span (Badge shell intact).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Deterministic i18n: t(key, fallback) returns the English fallback so the label
// assertions don't depend on translation-file contents. Mirrors the pattern used
// by the sibling CategoryBadge test in feedback-queue/.
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

import { StatusBadge } from './StatusBadge'
import type { FeedbackStatus } from '@/api/types'
import { BADGE_VARIANTS } from '@/components/ui';

function renderBadge(status: FeedbackStatus) {
  const { container } = render(<StatusBadge status={status} />)
  const chip = container.querySelector('span')
  return { container, chip }
}

const classFor = (status: FeedbackStatus) =>
  render(<StatusBadge status={status} />).container.querySelector('span')
    ?.className ?? ''

describe('StatusBadge', () => {
  it('renders a new item as an amber warning chip', () => {
    const { chip } = renderBadge('new')
    expect(chip).not.toBeNull()
    expect(chip?.textContent?.trim()).toBe('New')
    expect(chip?.className).toContain('bg-yellow-100')
    expect(chip?.className).toContain('text-yellow-800')
  })

  it('renders a triaged item as a green success chip', () => {
    const { chip } = renderBadge('triaged')
    expect(chip?.textContent?.trim()).toBe('Triaged')
    expect(chip?.className).toContain('bg-green-100')
    expect(chip?.className).toContain('text-green-800')
    expect(chip?.className).not.toContain('bg-yellow-100')
  })

  it('renders a closed item as a neutral grey chip', () => {
    const { chip } = renderBadge('closed')
    expect(chip?.textContent?.trim()).toBe('Closed')
    expect(chip?.className).toContain(BADGE_VARIANTS.neutral)
    expect(chip?.className).not.toContain('bg-green-100')
  })

  it('assigns a distinct variant colour per known status', () => {
    const knew = classFor('new')
    const triaged = classFor('triaged')
    const closed = classFor('closed')
    expect(knew).toContain('bg-yellow-100')
    expect(triaged).toContain('bg-green-100')
    expect(closed).toContain(BADGE_VARIANTS.neutral)
    expect(knew).not.toEqual(triaged)
    expect(triaged).not.toEqual(closed)
    expect(knew).not.toEqual(closed)
  })

  it('drives the visible label from i18n fallbacks, not the raw enum key', () => {
    renderBadge('new')
    // The translated fallback is shown; neither the enum value nor the i18n key
    // ever leaks to the UI.
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.queryByText('new')).toBeNull()
    expect(screen.queryByText('feedback.queue.status.new')).toBeNull()
  })

  it('fails closed to a neutral "Unknown" chip for an unknown status', () => {
    // Simulate a newer server enum leaking past the compile-time union.
    const unknownStatus = 'archived' as unknown as FeedbackStatus
    const { chip } = renderBadge(unknownStatus)
    expect(chip?.textContent?.trim()).toBe('Unknown')
    expect(chip?.className).toContain(BADGE_VARIANTS.neutral)
    // A still-active-but-unrecognised status must not be coloured as an active
    // (warning/success) state...
    expect(chip?.className).not.toContain('bg-yellow-100')
    expect(chip?.className).not.toContain('bg-green-100')
    // ...nor masked as the terminal "Closed" label.
    expect(chip?.textContent?.trim()).not.toBe('Closed')
  })

  it('never throws or renders an empty badge for an empty status string', () => {
    const emptyStatus = '' as unknown as FeedbackStatus
    expect(() => render(<StatusBadge status={emptyStatus} />)).not.toThrow()
    // Always the fail-closed label — never a blank, colourless chip.
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('never throws for a nullish status and stays on the neutral variant', () => {
    const missingStatus = undefined as unknown as FeedbackStatus
    expect(() => render(<StatusBadge status={missingStatus} />)).not.toThrow()
    const chip = screen.getByText('Unknown')
    expect(chip.className).toContain(BADGE_VARIANTS.neutral)
    expect(chip.textContent?.trim()).toBe('Unknown')
  })

  it('renders as a single inline-flex rounded-full Badge span', () => {
    const { container, chip } = renderBadge('new')
    const spans = container.querySelectorAll('span')
    expect(spans).toHaveLength(1)
    expect(chip?.className).toContain('inline-flex')
    expect(chip?.className).toContain('rounded-full')
    expect(chip?.className).toContain('font-medium')
  })
})
