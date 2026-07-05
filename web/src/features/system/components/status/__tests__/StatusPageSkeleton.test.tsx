import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * StatusPageSkeleton contract.
 *
 * A prop-less, state-invariant loading placeholder for the System Status page.
 * It renders no data and no interactive controls, so the behaviours worth
 * pinning are the ones that would silently regress and reintroduce a layout
 * shift or an inaccessible spinner:
 *
 *   1. a11y — the whole surface is ONE `role="status"` live region with
 *      `aria-busy="true"` and an i18n-labelled accessible name, so assistive
 *      tech announces "loading" rather than reading silent pulse blocks.
 *   2. i18n — the accessible name is sourced through `t()` (matching the
 *      natural-language keys the sibling SystemStatusPage uses), not a
 *      hardcoded string, and falls back to the English key when untranslated.
 *   3. Layout fidelity — the eight glass panels appear in the documented order
 *      (hero → health → action items → resources → 4 accordions), the chip bar
 *      has eight pills, and every band renders the exact placeholder count that
 *      mirrors the real page, so content doesn't reflow on arrival.
 *   4. Decorative-only — the placeholder blocks carry no text, so the aria-label
 *      is the sole announcement.
 *
 * Per the repo convention (see DigestSkeleton.test.tsx) react-i18next is stubbed
 * so `t(key, fallback)` echoes real copy and can be asserted against.
 */

const { tSpy } = vi.hoisted(() => ({
  tSpy: vi.fn((key: string, fallback?: string) => fallback ?? key),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tSpy,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

import { StatusPageSkeleton } from '../StatusPageSkeleton'

const PULSE = '.animate-pulse'
const PANEL = '[data-print-card]'

beforeEach(() => {
  tSpy.mockClear()
})

describe('StatusPageSkeleton', () => {
  it('exposes a single accessible, i18n-labelled busy status live region', () => {
    render(<StatusPageSkeleton />)

    const region = screen.getByTestId('status-page-skeleton')
    // The testid node IS the status live region (one region, not many).
    expect(region).toBe(screen.getByRole('status'))
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(region).toHaveAttribute('aria-label', 'Loading system status')
    expect(
      screen.getByRole('status', { name: 'Loading system status' }),
    ).toBeInTheDocument()
    // The vertical-rhythm + width container is preserved on the labelled node.
    expect(region).toHaveClass('space-y-5', 'max-w-3xl', 'mx-auto')
  })

  it('sources the accessible name from i18n and falls back to the English key', () => {
    render(<StatusPageSkeleton />)

    // The label is routed through t() with the natural-language key the rest of
    // SystemStatusPage uses — not a hardcoded literal.
    expect(tSpy).toHaveBeenCalledWith('Loading system status')
    // With no matching translation, react-i18next echoes the key → English copy.
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe(
      'Loading system status',
    )
  })

  it('renders the translated label when i18n provides one (proves it is not hardcoded)', () => {
    tSpy.mockReturnValueOnce('Estado del sistema cargando')
    render(<StatusPageSkeleton />)

    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Estado del sistema cargando',
    )
  })

  it('mirrors the status-page layout: eight glass panels with the documented placeholder counts', () => {
    const { container } = render(<StatusPageSkeleton />)

    const panels = Array.from(container.querySelectorAll(PANEL)) as HTMLElement[]
    expect(panels).toHaveLength(8)

    const [hero, health, actionItems, resources, ...accordions] = panels
    // Hero → avatar + title + subtitle + action button.
    expect(hero.querySelectorAll(PULSE)).toHaveLength(4)
    // Health → section title + six rows.
    expect(health.querySelectorAll(PULSE)).toHaveLength(1 + 6)
    // Action items → title + two rows.
    expect(actionItems.querySelectorAll(PULSE)).toHaveLength(1 + 2)
    // Resources → title + five rows.
    expect(resources.querySelectorAll(PULSE)).toHaveLength(1 + 5)
    // The remaining panels are the four accordion stubs.
    expect(accordions).toHaveLength(4)
  })

  it('renders four accordion stubs, each with a glyph/title/meta/badge quartet', () => {
    const { container } = render(<StatusPageSkeleton />)

    const accordions = (
      Array.from(container.querySelectorAll(PANEL)) as HTMLElement[]
    ).slice(4)
    expect(accordions).toHaveLength(4)
    for (const accordion of accordions) {
      expect(accordion.querySelectorAll(PULSE)).toHaveLength(4)
    }
  })

  it('renders the chip bar as eight pill-shaped placeholders in a non-panel row', () => {
    render(<StatusPageSkeleton />)

    const region = screen.getByTestId('status-page-skeleton')
    // Eight panels + one chip bar = nine direct children.
    expect(region.children).toHaveLength(9)

    // The chip bar is the only non-panel direct child (a plain flex row).
    const chipBar = region.children[1] as HTMLElement
    expect(chipBar).not.toHaveAttribute('data-print-card')

    const chips = Array.from(chipBar.querySelectorAll(PULSE)) as HTMLElement[]
    expect(chips).toHaveLength(8)
    for (const chip of chips) {
      expect(chip.className).toContain('rounded-full')
      expect(chip.className).toContain('shrink-0')
    }
  })

  it('renders decorative-only pulse blocks so the aria-label is the sole announcement', () => {
    const { container } = render(<StatusPageSkeleton />)
    const region = screen.getByTestId('status-page-skeleton')

    // 4 hero + 8 chips + 7 health + 3 action + 6 resources + 16 accordions = 44.
    expect(container.querySelectorAll(PULSE)).toHaveLength(44)
    // No readable text — assistive tech only hears the aria-label.
    expect(region.textContent).toBe('')
  })
})
