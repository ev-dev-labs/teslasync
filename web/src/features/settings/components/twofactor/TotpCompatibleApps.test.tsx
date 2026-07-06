/**
 * TotpCompatibleApps contract.
 *
 * A static, presentational reassurance panel — no network, no hooks beyond
 * i18n. The tests lock down the behaviour that actually matters:
 *   1. It renders a translated heading + subtitle, each requested from i18n
 *      with an English fallback.
 *   2. It renders all six compatible-app brand names, in order, verbatim —
 *      they are proper nouns and must NEVER be routed through i18n.
 *   3. The app list carries an accessible name wired to the panel heading
 *      (the `aria-labelledby` → heading `id` relationship must resolve).
 *   4. Every icon is decorative (aria-hidden) and none leaks into the a11y
 *      tree as an image.
 *   5. A missing/empty translation degrades the heading + subtitle to an
 *      em-dash placeholder instead of collapsing to a blank line — and the
 *      brand list is unaffected.
 *   6. The default export is the same component as the named export.
 *
 * react-i18next is stubbed via a swappable `translate` impl (repo convention:
 * return the English fallback so assertions are deterministic; one test
 * overrides it to simulate an empty translation).
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

import TotpCompatibleApps, {
  TotpCompatibleApps as NamedPanel,
} from './TotpCompatibleApps'

const APP_NAMES = [
  'Google Authenticator',
  '1Password',
  'Bitwarden',
  'Authy',
  'Microsoft Authenticator',
  'Ente Auth',
] as const

beforeEach(() => {
  h.translate.mockReset()
  h.translate.mockImplementation(
    (key: string, fallback?: string) => fallback ?? key,
  )
})

describe('TotpCompatibleApps', () => {
  it('renders the translated heading and subtitle', () => {
    render(<TotpCompatibleApps />)

    const heading = screen.getByRole('heading', {
      level: 3,
      name: 'Compatible apps',
    })
    expect(heading).toBeInTheDocument()
    expect(
      screen.getByText('Any RFC 6238 TOTP client works.'),
    ).toBeInTheDocument()
  })

  it('requests the heading and subtitle from i18n with English fallbacks', () => {
    render(<TotpCompatibleApps />)

    expect(h.translate).toHaveBeenCalledWith(
      'totp.apps.title',
      'Compatible apps',
    )
    expect(h.translate).toHaveBeenCalledWith(
      'totp.apps.subtitle',
      'Any RFC 6238 TOTP client works.',
    )
  })

  it('renders all six compatible-app brand names, in order', () => {
    render(<TotpCompatibleApps />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(6)
    expect(items.map((li) => li.textContent)).toEqual([...APP_NAMES])
  })

  it('never routes brand names through i18n (they are proper nouns)', () => {
    // Even with a hostile translator that rewrites *every* string, the six
    // brand names must survive verbatim — proof they bypass the catalog.
    h.translate.mockImplementation(() => 'LOCALISED')

    render(<TotpCompatibleApps />)

    for (const name of APP_NAMES) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
    // And the translator was never asked to translate a brand name.
    for (const call of h.translate.mock.calls) {
      expect(APP_NAMES).not.toContain(call[0])
    }
  })

  it('names the app list via its panel heading (aria-labelledby resolves)', () => {
    render(<TotpCompatibleApps />)

    const heading = screen.getByRole('heading', { level: 3 })
    const list = screen.getByRole('list')

    // The heading must carry an id, and the list must point at exactly that
    // id — otherwise the accessible name silently breaks.
    expect(heading.id).toBeTruthy()
    expect(list).toHaveAttribute('aria-labelledby', heading.id)

    // …and the computed accessible name resolves to the heading text.
    expect(
      screen.getByRole('list', { name: 'Compatible apps' }),
    ).toBe(list)
  })

  it('marks every icon as decorative and exposes none as an image', () => {
    const { container } = render(<TotpCompatibleApps />)

    // One header icon + one per list row = 7 decorative svgs.
    const icons = container.querySelectorAll('svg[aria-hidden="true"]')
    expect(icons).toHaveLength(7)
    expect(screen.queryByRole('img')).toBeNull()

    // Each list row pairs a decorative icon with its label.
    const list = screen.getByRole('list')
    for (const item of within(list).getAllByRole('listitem')) {
      expect(item.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    }
  })

  it('degrades an empty translation to an em-dash instead of a blank header', () => {
    // Simulate a locale where the heading + subtitle keys resolve to ''.
    h.translate.mockImplementation(() => '')

    render(<TotpCompatibleApps />)

    // Header structure survives: heading + subtitle both show the placeholder.
    const heading = screen.getByRole('heading', { level: 3 })
    expect(heading).toHaveTextContent('—')
    expect(screen.getAllByText('—')).toHaveLength(2)

    // The brand list is unaffected — still six items, still named by the
    // (now placeholder) heading.
    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(6)
    expect(list).toHaveAttribute('aria-labelledby', heading.id)
  })
})

describe('module surface', () => {
  it('re-exports the same component as its default and named export', () => {
    expect(TotpCompatibleApps).toBe(NamedPanel)
    expect(typeof TotpCompatibleApps).toBe('function')
  })
})
