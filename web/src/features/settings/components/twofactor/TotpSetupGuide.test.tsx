/**
 * TotpSetupGuide contract.
 *
 * A static, presentational walkthrough — no network, no hooks beyond i18n.
 * The tests lock down the behaviour that actually matters:
 *   1. It renders a translated heading + subtitle, each requested from i18n
 *      with an English fallback.
 *   2. It renders all four steps, in order, each with its translated title,
 *      body and a 1-based ordinal badge.
 *   3. Every step's title + body is requested from i18n with an English
 *      fallback (proof the copy is fully catalog-driven).
 *   4. The ordered list carries an accessible name wired to the panel heading
 *      (the `aria-labelledby` → heading `id` relationship must resolve).
 *   5. The header icon is decorative (aria-hidden) and never leaks into the
 *      a11y tree as an image; the ordinal badges are decorative too, since the
 *      <ol> already conveys position.
 *   6. A missing/empty translation degrades every string to an em-dash
 *      placeholder instead of collapsing to a blank line — and the list keeps
 *      its four items, its name and its (untranslated) ordinal badges, i.e. the
 *      em-dash guard must not collide the React keys.
 *   7. The default export is the same component as the named export.
 *
 * react-i18next is stubbed via a swappable `translate` impl (repo convention:
 * return the English fallback so assertions are deterministic; two tests
 * override it to simulate an empty translation / a hostile translator).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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

import TotpSetupGuide, {
  TotpSetupGuide as NamedGuide,
} from './TotpSetupGuide'

const STEP_TITLES = [
  'Install an authenticator app',
  'Scan the QR code',
  'Verify a 6-digit code',
  'Store your backup codes',
] as const

const STEP_BODIES = [
  'Use any RFC 6238 client — Google Authenticator, 1Password, Bitwarden or Authy.',
  'Choose Enable TOTP, then scan the QR or paste the manual secret into your app.',
  'Enter the rotating code your app shows to confirm both devices are in sync.',
  'Save the one-time codes somewhere safe — they recover access if you lose your app.',
] as const

beforeEach(() => {
  h.translate.mockReset()
  h.translate.mockImplementation(
    (key: string, fallback?: string) => fallback ?? key,
  )
})

describe('TotpSetupGuide', () => {
  it('renders the translated heading and subtitle', () => {
    render(<TotpSetupGuide />)

    const heading = screen.getByRole('heading', {
      level: 3,
      name: 'How setup works',
    })
    expect(heading).toBeInTheDocument()
    expect(
      screen.getByText('Four steps, about a minute.'),
    ).toBeInTheDocument()
  })

  it('requests the heading and subtitle from i18n with English fallbacks', () => {
    render(<TotpSetupGuide />)

    expect(h.translate).toHaveBeenCalledWith(
      'totp.guide.title',
      'How setup works',
    )
    expect(h.translate).toHaveBeenCalledWith(
      'totp.guide.subtitle',
      'Four steps, about a minute.',
    )
  })

  it('renders all four steps, in order, each with a 1-based ordinal badge', () => {
    render(<TotpSetupGuide />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(4)

    items.forEach((li, i) => {
      expect(li).toHaveTextContent(STEP_TITLES[i])
      expect(li).toHaveTextContent(STEP_BODIES[i])
      // The visible ordinal badge is the human-readable step number.
      expect(within(li).getByText(String(i + 1))).toBeInTheDocument()
    })
  })

  it('requests every step title and body from i18n with English fallbacks', () => {
    render(<TotpSetupGuide />)

    STEP_TITLES.forEach((title, i) => {
      expect(h.translate).toHaveBeenCalledWith(
        `totp.guide.step${i + 1}.title`,
        title,
      )
    })
    STEP_BODIES.forEach((body, i) => {
      expect(h.translate).toHaveBeenCalledWith(
        `totp.guide.step${i + 1}.body`,
        body,
      )
    })
  })

  it('names the ordered step list via its panel heading (aria-labelledby resolves)', () => {
    render(<TotpSetupGuide />)

    const heading = screen.getByRole('heading', { level: 3 })
    const list = screen.getByRole('list')

    // The heading must carry an id, and the list must point at exactly that
    // id — otherwise the accessible name silently breaks.
    expect(heading.id).toBeTruthy()
    expect(list).toHaveAttribute('aria-labelledby', heading.id)

    // …and the computed accessible name resolves to the heading text.
    expect(screen.getByRole('list', { name: 'How setup works' })).toBe(list)
  })

  it('marks the header icon decorative and exposes no image', () => {
    const { container } = render(<TotpSetupGuide />)

    // Only the header ListChecks glyph is an svg; it must be decorative.
    const icons = container.querySelectorAll('svg[aria-hidden="true"]')
    expect(icons).toHaveLength(1)
    expect(screen.queryByRole('img')).toBeNull()

    // The four ordinal badges are decorative too — the <ol> already conveys
    // position, so the visual number must not double-announce.
    const badges = container.querySelectorAll('span[aria-hidden="true"]')
    expect(badges).toHaveLength(4)
  })

  it('never re-runs translations through a hostile locale for the ordinal badges', () => {
    // Even with a translator that rewrites *every* string, the ordinal badges
    // are computed from the index, not the catalog — they must survive verbatim.
    h.translate.mockImplementation(() => 'LOCALISED')

    render(<TotpSetupGuide />)

    const list = screen.getByRole('list')
    for (let n = 1; n <= 4; n += 1) {
      expect(within(list).getByText(String(n))).toBeInTheDocument()
    }
  })

  it('degrades empty translations to an em-dash without breaking the list', () => {
    // Simulate a locale where every key resolves to '' — the guard must fall
    // back to an em-dash rather than collapse to blank lines, and the shared
    // em-dash must NOT collide the list keys (a title-based key would).
    h.translate.mockImplementation(() => '')

    render(<TotpSetupGuide />)

    // Header structure survives: heading + subtitle both show the placeholder.
    const heading = screen.getByRole('heading', { level: 3 })
    expect(heading).toHaveTextContent('—')

    // 1 heading + 1 subtitle + 4 step titles + 4 step bodies = 10 placeholders.
    expect(screen.getAllByText('—')).toHaveLength(10)

    // The step list is unaffected: still four items, still named by the (now
    // placeholder) heading, and its untranslated ordinal badges still render —
    // proof the em-dash guard did not collide the React keys.
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    expect(list).toHaveAttribute('aria-labelledby', heading.id)
    expect(within(list).getByText('1')).toBeInTheDocument()
    expect(within(list).getByText('4')).toBeInTheDocument()
  })
})

describe('module surface', () => {
  it('re-exports the same component as its default and named export', () => {
    expect(TotpSetupGuide).toBe(NamedGuide)
    expect(typeof TotpSetupGuide).toBe('function')
  })
})
