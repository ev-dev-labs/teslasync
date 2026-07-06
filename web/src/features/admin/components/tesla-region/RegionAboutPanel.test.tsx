/**
 * RegionAboutPanel contract tests.
 *
 * RegionAboutPanel is a static, prop-less, presentational reference card. It has
 * no data source, so there are no loading / error / empty branches to exercise —
 * instead these tests pin the always-visible content and the two hardening
 * guarantees the elevation adds:
 *
 *   1. It always renders its "About your region" panel heading, the
 *      explanatory prose, and the "Fleet API zones" section label.
 *   2. The zone rows are DRIVEN BY the single source of truth
 *      (`REGION_ZONE_KEYS` / `REGION_ZONE_FALLBACK` in ./helpers) — one row per
 *      known zone, in order, each badge showing the uppercased zone code and
 *      each row labelled with that zone's canonical fallback description. This
 *      guards against the previous hardcoded na/eu/cn list silently drifting out
 *      of sync with the helpers.
 *   3. Accessibility: the zones list is a real <ul> whose accessible name comes
 *      from the section label via `aria-labelledby`, and the decorative Info
 *      glyph is hidden from assistive tech.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

// Deterministic i18n: `t(key, default, opts)` returns the default string with
// any `{{token}}` interpolated, so assertions never depend on the shipped
// translation catalogue. Matches the convention used across the admin tests.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next')
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            )
          }
          return fallbackOrOpts
        }
        return key
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  }
})

import { RegionAboutPanel } from './RegionAboutPanel'
import { REGION_ZONE_KEYS, REGION_ZONE_FALLBACK } from './helpers'

describe('RegionAboutPanel — always-visible content', () => {
  it('renders the "About your region" panel heading', () => {
    render(<RegionAboutPanel />)

    const heading = screen.getByRole('heading', { name: 'About your region' })
    expect(heading).toBeInTheDocument()
    // PanelTitle renders an <h3>.
    expect(heading.tagName).toBe('H3')
  })

  it('renders the explanatory prose describing the regional Fleet API host', () => {
    render(<RegionAboutPanel />)

    const body = screen.getByText(/Tesla homes every account to a regional Fleet API host/i)
    expect(body).toBeInTheDocument()
    // The prose is a paragraph (Text as="p"), not a bare span.
    expect(body.tagName).toBe('P')
  })

  it('renders the "Fleet API zones" section label', () => {
    render(<RegionAboutPanel />)

    expect(screen.getByText('Fleet API zones')).toBeInTheDocument()
  })
})

describe('RegionAboutPanel — zone rows driven by the single source of truth', () => {
  it('renders exactly one row per known Fleet API zone', () => {
    render(<RegionAboutPanel />)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(REGION_ZONE_KEYS.length)
    expect(items).toHaveLength(3)
  })

  it('shows each zone code as an uppercased badge, in REGION_ZONE_KEYS order', () => {
    render(<RegionAboutPanel />)

    const items = screen.getAllByRole('listitem')
    const codes = items.map((li) => within(li).getByText(/^[A-Z]{2}$/).textContent)

    expect(codes).toEqual(REGION_ZONE_KEYS.map((k) => k.toUpperCase()))
    expect(codes).toEqual(['NA', 'EU', 'CN'])
  })

  it('labels every zone with its canonical fallback description', () => {
    render(<RegionAboutPanel />)

    for (const key of REGION_ZONE_KEYS) {
      expect(screen.getByText(REGION_ZONE_FALLBACK[key])).toBeInTheDocument()
    }
    // Spot-check a specific mapping so the assertion isn't purely structural.
    expect(screen.getByText('China')).toBeInTheDocument()
  })

  it('pairs each uppercased code with its matching description in the same row', () => {
    render(<RegionAboutPanel />)

    const items = screen.getAllByRole('listitem')
    REGION_ZONE_KEYS.forEach((key, i) => {
      const row = items[i]
      expect(within(row).getByText(key.toUpperCase())).toBeInTheDocument()
      expect(within(row).getByText(REGION_ZONE_FALLBACK[key])).toBeInTheDocument()
    })
  })
})

describe('RegionAboutPanel — accessibility', () => {
  it('exposes the zones list as a real <ul> named by its section label', () => {
    render(<RegionAboutPanel />)

    // The <ul> derives its accessible name from the "Fleet API zones" label via
    // aria-labelledby.
    const list = screen.getByRole('list', { name: 'Fleet API zones' })
    expect(list).toBeInTheDocument()
    expect(list.tagName).toBe('UL')

    const label = screen.getByText('Fleet API zones')
    expect(list).toHaveAttribute('aria-labelledby', label.id)
    expect(label.id).not.toBe('')
  })

  it('hides the decorative Info glyph from assistive technology', () => {
    const { container } = render(<RegionAboutPanel />)

    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })
})
