/**
 * PrivacyGuaranteesPanel contract.
 *
 * A static, presentational "how we handle your data" band — no network, no
 * hooks beyond i18n. The tests lock down the behaviour that actually matters:
 *   1. It exposes an accessible `region` landmark named by its section heading
 *      (the aria-labelledby wiring must resolve).
 *   2. It renders all three guarantee tiles (title + body) from i18n keys, in
 *      order, each with a decorative (aria-hidden) icon and its own neon-color
 *      accent.
 *   3. Every string is requested from i18n with an English fallback.
 *   4. A missing/empty translation degrades to an em-dash placeholder rather
 *      than collapsing a tile to a blank line.
 *   5. The default export is the same component as the named export.
 *
 * react-i18next is stubbed via a swappable `translate` impl (repo convention:
 * return the English fallback so assertions are deterministic; one test
 * overrides it to simulate an empty translation).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const h = vi.hoisted(() => ({
  // Default: behave like i18next-with-fallback — echo the English default
  // string the caller passes as the second argument.
  translate: vi.fn((key: string, fallback?: string) => fallback ?? key),
}))

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) =>
        h.translate(
          key,
          typeof fallbackOrOpts === 'string' ? fallbackOrOpts : undefined,
        ),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import PrivacyGuaranteesPanel, {
  PrivacyGuaranteesPanel as NamedPanel,
} from './PrivacyGuaranteesPanel'

beforeEach(() => {
  h.translate.mockReset()
  h.translate.mockImplementation(
    (key: string, fallback?: string) => fallback ?? key,
  )
})

describe('PrivacyGuaranteesPanel', () => {
  it('renders an accessible region named by its section heading', () => {
    render(<PrivacyGuaranteesPanel />)

    const region = screen.getByRole('region', {
      name: /how teslasync handles this data/i,
    })
    expect(region).toBeInTheDocument()

    const heading = screen.getByRole('heading', {
      level: 2,
      name: /how teslasync handles this data/i,
    })
    // The section is labelled *by* that heading — the aria-labelledby target
    // must exist and match the heading's id, or the landmark name breaks.
    expect(heading).toHaveAttribute('id', 'privacy-about-heading')
    expect(region).toHaveAttribute(
      'aria-labelledby',
      heading.getAttribute('id'),
    )
  })

  it('renders all three guarantee tiles with their translated titles, in order', () => {
    render(<PrivacyGuaranteesPanel />)

    const tileHeadings = screen.getAllByRole('heading', { level: 4 })
    expect(tileHeadings).toHaveLength(3)
    expect(tileHeadings.map((el) => el.textContent)).toEqual([
      'Stored on this device',
      'No cross-device sync',
      'You stay in control',
    ])
  })

  it('renders the explanatory body copy for each guarantee', () => {
    render(<PrivacyGuaranteesPanel />)

    expect(
      screen.getByText(/never uploaded to the server/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/no effect on your other devices/i),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/take effect immediately and update every open tab/i),
    ).toBeInTheDocument()
  })

  it('requests every string from i18n with an English fallback', () => {
    render(<PrivacyGuaranteesPanel />)

    expect(h.translate).toHaveBeenCalledWith(
      'account.privacy.about.title',
      'How TeslaSync handles this data',
    )
    expect(h.translate).toHaveBeenCalledWith(
      'account.privacy.about.localTitle',
      'Stored on this device',
    )
    expect(h.translate).toHaveBeenCalledWith(
      'account.privacy.about.controlBody',
      expect.stringContaining('every open tab'),
    )
  })

  it('marks the leading tile icons as decorative (aria-hidden)', () => {
    const { container } = render(<PrivacyGuaranteesPanel />)

    // Exactly one decorative svg per tile, and none exposed to the a11y tree.
    const icons = container.querySelectorAll('svg[aria-hidden="true"]')
    expect(icons).toHaveLength(3)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('wires each guarantee to its own neon-color accent', () => {
    const { container } = render(<PrivacyGuaranteesPanel />)

    const iconBoxes = Array.from(
      container.querySelectorAll('svg[aria-hidden="true"]'),
    ).map((svg) => svg.parentElement as HTMLElement)

    expect(iconBoxes[0].className).toContain('bg-neon-cyan/10')
    expect(iconBoxes[1].className).toContain('bg-neon-blue/10')
    expect(iconBoxes[2].className).toContain('bg-neon-green/10')
  })

  it('degrades an empty translation to an em-dash instead of a blank tile', () => {
    // Simulate a locale where these keys resolve to an empty string.
    h.translate.mockImplementation(() => '')

    render(<PrivacyGuaranteesPanel />)

    // Structure survives: still three tiles…
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(3)
    // …and every title + body slot shows the placeholder, never a blank line.
    expect(screen.getAllByText('—')).toHaveLength(6)
  })
})

describe('module surface', () => {
  it('re-exports the same component as its default and named export', () => {
    expect(PrivacyGuaranteesPanel).toBe(NamedPanel)
    expect(typeof PrivacyGuaranteesPanel).toBe('function')
  })
})
