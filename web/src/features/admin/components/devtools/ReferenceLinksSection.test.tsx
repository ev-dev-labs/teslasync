/**
 * ReferenceLinksSection contract tests.
 *
 * ReferenceLinksSection is the "Reference" tab of the Developer Tools page: a
 * responsive grid of external documentation cards derived from the shared
 * REFERENCE_LINKS catalog. It is a pure presentational mapper (no network,
 * react-query, or router), so these tests drive it entirely through the
 * catalog and assert the rendered contract:
 *
 *   1. Structure    — one external-link card per catalog entry, each pointing
 *                     at its URL.
 *   2. Safe new tab — every card opens in a new tab with
 *                     rel="noopener noreferrer" (tab-nabbing guard).
 *   3. Labelling    — the translated title + destination URL render, and the
 *                     accessible name carries a screen-reader "opens in a new
 *                     tab" hint.
 *   4. i18n default — a link with no English default gracefully falls back to
 *                     its i18n key instead of rendering blank (regression guard
 *                     for the "raw key shown" bug this file fixes).
 *   5. Icon mapping — recognised icon keys map to distinct glyphs; an
 *                     unrecognised key falls back to the BookOpen glyph.
 *   6. a11y         — decorative icon glyphs are aria-hidden.
 *   7. Empty state  — an empty catalog degrades to an EmptyState landmark, not
 *                     a blank grid.
 *   8. Null safety  — a link with a missing URL renders a "—" placeholder
 *                     without crashing.
 *   9. Real catalog — the actual production REFERENCE_LINKS render end-to-end.
 *
 * `react-i18next` is mocked (the same seam the sibling DevToolsOverview test
 * uses) so `t(key, fallback)` returns the English default and label assertions
 * stay deterministic. `./constants` is mocked with a mutable REFERENCE_LINKS
 * array (ICON_COLOR_MAP kept real) so each test can inject its own catalog
 * without hitting constant drift.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// t(key, fallback) → the fallback string when one is supplied, else the raw
// key. Mirrors the sibling devtools tests so labels read as English defaults.
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

type RefLink = { title: string; url?: string; icon: string; label?: string }

// Controllable catalog. The array reference is stable — the component holds the
// same reference via its module import — so each test rewrites its CONTENTS in
// place (never reassigns) and the next render observes the current fixture.
const mock = vi.hoisted(() => ({ links: [] as RefLink[] }))

vi.mock('./constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./constants')>()
  return { ...actual, REFERENCE_LINKS: mock.links }
})

import { ReferenceLinksSection } from './ReferenceLinksSection'

function setLinks(links: RefLink[]) {
  mock.links.splice(0, mock.links.length, ...links)
}

/** The <svg> class string for the card whose accessible name matches `name`. */
function iconClassFor(name: RegExp): string {
  const svg = screen.getByRole('link', { name }).querySelector('svg')
  expect(svg).not.toBeNull()
  return svg!.getAttribute('class') ?? ''
}

beforeEach(() => setLinks([]))

describe('ReferenceLinksSection', () => {
  it('renders one external-link card per catalog entry, each opening safely in a new tab', () => {
    setLinks([
      { title: 'devtools.ref.a', url: 'https://a.example', icon: 'BookOpen', label: 'Alpha Docs' },
      { title: 'devtools.ref.b', url: 'https://b.example', icon: 'Globe', label: 'Bravo Docs' },
    ])
    render(<ReferenceLinksSection />)

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    for (const anchor of links) {
      expect(anchor).toHaveAttribute('target', '_blank')
      // Both tokens are required — noreferrer alone still leaks the opener in
      // some engines, noopener alone still leaks the referrer.
      expect(anchor.getAttribute('rel')).toContain('noopener')
      expect(anchor.getAttribute('rel')).toContain('noreferrer')
    }

    expect(screen.getByRole('link', { name: /Alpha Docs/ })).toHaveAttribute(
      'href',
      'https://a.example',
    )
    expect(screen.getByRole('link', { name: /Bravo Docs/ })).toHaveAttribute(
      'href',
      'https://b.example',
    )
  })

  it('labels each card with the translated title, destination URL, and a screen-reader new-tab hint', () => {
    setLinks([
      { title: 'devtools.ref.a', url: 'https://a.example/path', icon: 'Globe', label: 'Alpha Docs' },
    ])
    render(<ReferenceLinksSection />)

    expect(screen.getByText('Alpha Docs')).toBeInTheDocument()
    expect(screen.getByText('https://a.example/path')).toBeInTheDocument()

    const link = screen.getByRole('link', { name: /Alpha Docs/ })
    // The visually-hidden hint is part of the accessible name so AT announces
    // the external navigation.
    expect(link).toHaveAccessibleName(/opens in a new tab/i)
  })

  it('falls back to the i18n key when a link has no English default label', () => {
    setLinks([{ title: 'devtools.ref.nolabel', url: 'https://n.example', icon: 'Globe' }])
    render(<ReferenceLinksSection />)

    // `label ?? title` — never a blank card; the key is shown as a last resort.
    expect(screen.getByText('devtools.ref.nolabel')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /devtools\.ref\.nolabel/ }),
    ).toBeInTheDocument()
  })

  it('maps recognised icon keys to distinct glyphs', () => {
    setLinks([
      { title: 'x.book', url: 'https://book.example', icon: 'BookOpen', label: 'Book Card' },
      { title: 'x.globe', url: 'https://globe.example', icon: 'Globe', label: 'Globe Card' },
    ])
    render(<ReferenceLinksSection />)

    expect(iconClassFor(/Book Card/)).not.toBe(iconClassFor(/Globe Card/))
  })

  it('falls back to the BookOpen glyph for an unrecognised icon key', () => {
    setLinks([
      { title: 'x.known', url: 'https://known.example', icon: 'BookOpen', label: 'Known Card' },
      { title: 'x.unknown', url: 'https://unknown.example', icon: 'NotARealIcon', label: 'Unknown Card' },
    ])
    render(<ReferenceLinksSection />)

    // The unknown key resolves to the same BookOpen glyph as the explicit one,
    // so their rendered <svg> class strings are identical.
    expect(iconClassFor(/Unknown Card/)).toBe(iconClassFor(/Known Card/))
  })

  it('hides decorative icon glyphs from assistive technology', () => {
    setLinks([{ title: 'x.radio', url: 'https://radio.example', icon: 'Radio', label: 'Radio Card' }])
    render(<ReferenceLinksSection />)

    const svg = screen.getByRole('link', { name: /Radio Card/ }).querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders an empty state instead of a blank grid when the catalog is empty', () => {
    setLinks([])
    render(<ReferenceLinksSection />)

    expect(screen.queryAllByRole('link')).toHaveLength(0)
    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status).toHaveTextContent(/no reference links/i)
  })

  it('renders a "—" placeholder for a link with a missing URL without crashing', () => {
    setLinks([{ title: 'devtools.ref.nourl', icon: 'Radio', label: 'No URL Card' }])

    expect(() => render(<ReferenceLinksSection />)).not.toThrow()
    expect(screen.getByText('No URL Card')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders the real production reference catalog end-to-end', async () => {
    const actual =
      await vi.importActual<typeof import('./constants')>('./constants')
    const catalog = actual.REFERENCE_LINKS as RefLink[]
    setLinks(catalog)
    render(<ReferenceLinksSection />)

    expect(screen.getAllByRole('link')).toHaveLength(catalog.length)
    expect(catalog.length).toBeGreaterThan(0)
    for (const link of catalog) {
      expect(screen.getByText(link.url as string)).toBeInTheDocument()
    }
    // The English defaults render (never a raw `devtools.ref.*` key).
    expect(screen.getByText('Fleet API Overview')).toBeInTheDocument()
    expect(screen.queryByText('devtools.ref.fleetOverview')).toBeNull()
  })
})
